package com.solaris.nav;
import org.json.*;
import java.util.*;

/** Compare only validated alternatives. Missing sun evidence never means safe. */
final class RecoveryPreference {
    static JSONObject choose(List<JSONObject> routes,JSONObject policy,long now)throws JSONException {
        Collections.sort(routes,(a,b)->Double.compare(a.optJSONObject("rawRoute").optDouble("duration",Double.MAX_VALUE),b.optJSONObject("rawRoute").optDouble("duration",Double.MAX_VALUE)));
        JSONObject base=routes.get(0),chosen=base;String mode=policy==null?"fastest":policy.optString("mode","fastest");
        String reason="fastest";double baseTime=base.getJSONObject("rawRoute").getDouble("duration");
        double budget=policy==null?0:Math.max(0,Math.min(600,policy.optDouble("budgetSeconds",0)));
        if("simple".equals(mode)) {
            double best=complexity(base);int u=uturns(base);
            for(JSONObject r:routes){double score=complexity(r),extra=r.getJSONObject("rawRoute").getDouble("duration")-baseTime;
                if(uturns(r)<=u&&score<best&&extra<=Math.min(budget,Math.min(120,baseTime*.2))&&extra<=(complexity(base)-score)*30){chosen=r;best=score;}}
            reason=chosen==base?"no-comfort-benefit":"fewer-turns";
        } else if("glareFree".equals(mode)||"shade".equals(mode)) {
            reason="sun-evidence-unavailable";
            if(policy!=null&&now>=policy.optLong("createdAt")&&now-policy.optLong("createdAt")<=600000){
                double[] reference=exposure(base,policy.optJSONArray("segments"),now);double best=reference==null?Double.MAX_VALUE:reference["shade".equals(mode)?1:0];
                if(reference!=null){reason="no-sun-benefit";for(JSONObject r:routes){
                    double extra=r.getJSONObject("rawRoute").getDouble("duration")-baseTime;
                    if(extra>Math.min(budget,baseTime*.35))continue;
                    double[] evidence=exposure(r,policy.optJSONArray("segments"),now);int metric="shade".equals(mode)?1:0;
                    if(evidence!=null&&evidence[metric]<best*.9&&evidence[2]<=reference[2]&&evidence[3]<=reference[3]){chosen=r;best=evidence[metric];reason="cached-sun-comparison";}
                }}
            }
        }
        chosen.put("recoveryPreference",mode).put("recoveryReason",reason);return chosen;
    }
    static int uturns(JSONObject r)throws JSONException {int n=0;for(JSONObject s:steps(r))if("uturn".equals(s.getJSONObject("maneuver").optString("modifier")))n++;return n;}
    static double complexity(JSONObject r)throws JSONException {double score=0;for(JSONObject s:steps(r)){JSONObject m=s.getJSONObject("maneuver");String type=m.optString("type"),modifier=m.optString("modifier");if("uturn".equals(modifier))score+=5;else if(!"depart".equals(type)&&!"arrive".equals(type)&&!"continue".equals(type)){score+=1;if(s.optDouble("distance",1000)<120)score+=1;if(type.contains("ramp")||"fork".equals(type))score+=1;}}return score;}
    private static List<JSONObject> steps(JSONObject r)throws JSONException {JSONArray a=r.getJSONObject("rawRoute").getJSONArray("legs").getJSONObject(0).getJSONArray("steps");List<JSONObject> out=new ArrayList<>();for(int i=0;i<a.length();i++)out.add(a.getJSONObject(i));return out;}
    static double[] exposure(JSONObject r,JSONArray cache,long now)throws JSONException {
        if(cache==null||cache.length()>512)return null;
        JSONArray coords=r.getJSONArray("coordinates");if(coords.length()>10000)return null;
        double total=r.getDouble("geometryMeters"),duration=r.getJSONObject("rawRoute").getDouble("duration"),done=0,risk=0,exposed=0,high=0,max=0;
        int samples=0;
        for(int i=1;i<coords.length();i++){
            JSONArray a=coords.getJSONArray(i-1),b=coords.getJSONArray(i);double ax=a.getDouble(0),ay=a.getDouble(1),bx=b.getDouble(0),by=b.getDouble(1);
            double length=NavigationProgress.distance(ax,ay,bx,by);if(length<.1)continue;
            int parts=(int)Math.ceil(length/30);if(samples+parts>1024)return null;samples+=parts;
            for(int p=0;p<parts;p++){
                double t=(p+.5)/parts,x=ax+(bx-ax)*t,y=ay+(by-ay)*t,at=now+duration*1000*(done+length*t)/total;
                JSONArray hit=null;double closest=Double.MAX_VALUE;
                for(int j=0;j<cache.length();j++){
                    JSONArray c=cache.optJSONArray(j);if(c==null||c.length()!=7||Math.abs(at-c.optDouble(6))>120000)continue;
                    double cx=c.optDouble(0),cy=c.optDouble(1),dx=c.optDouble(2)-cx,dy=c.optDouble(3)-cy,cos=Math.cos(y*Math.PI/180);
                    double dot=((bx-ax)*cos*dx*cos+(by-ay)*dy),norm=Math.hypot((bx-ax)*cos,by-ay)*Math.hypot(dx*cos,dy);
                    if(norm<=0||dot/norm<.98)continue;
                    double u=((x-cx)*cos*dx*cos+(y-cy)*dy)/(dx*dx*cos*cos+dy*dy);if(u<0||u>1)continue;
                    double distance=NavigationProgress.distance(x,y,cx+u*dx,cy+u*dy);
                    if(distance<2&&distance<closest){closest=distance;hit=c;}
                }
                if(hit==null)return null;
                double seconds=duration*length/parts/total,g=hit.getDouble(4),shade=hit.getDouble(5);
                if(!NavigationProgress.finite(g)||!NavigationProgress.finite(shade)||g<0||g>1||shade<0||shade>1)return null;
                risk+=g*seconds;exposed+=(1-shade)*seconds;if(g>.45)high+=seconds;max=Math.max(max,g);
            }done+=length;
        }
        return samples>0?new double[]{risk,exposed,high,max}:null;
    }
}
