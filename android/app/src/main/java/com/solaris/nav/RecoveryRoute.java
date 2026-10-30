package com.solaris.nav;

import org.json.*;

/** Validated ordinary driving route. Does not claim a sunlight/shade optimization. */
final class RecoveryRoute {
    static JSONObject parse(JSONObject body,double[] start,double[] end,String language) throws JSONException {
        if(!"Ok".equals(body.optString("code"))) throw new JSONException("No driving route");
        JSONArray ways=body.getJSONArray("waypoints"),routes=body.getJSONArray("routes");
        if(ways.length()!=2||routes.length()<1)throw new JSONException("Invalid waypoints");
        for(int i=0;i<2;i++) {
            JSONArray p=ways.getJSONObject(i).getJSONArray("location"); double[] expected=i==0?start:end;
            if(distance(p,expected)>40)throw new JSONException("Endpoint snap too far");
        }
        JSONObject raw=routes.getJSONObject(0);
        if(!(raw.getDouble("duration")>0)||!NavigationProgress.finite(raw.getDouble("duration"))||!(raw.getDouble("distance")>0)||!NavigationProgress.finite(raw.getDouble("distance")))throw new JSONException("Invalid route totals");
        JSONArray coords=raw.getJSONObject("geometry").getJSONArray("coordinates");
        if(coords.length()<2||coords.length()>50000)throw new JSONException("Route size");
        double[] meters=new double[coords.length()];
        for(int i=0;i<coords.length();i++) {
            JSONArray p=coords.getJSONArray(i); double lon=p.getDouble(0),lat=p.getDouble(1);
            if(!NavigationProgress.finite(lon)||!NavigationProgress.finite(lat)||Math.abs(lon)>180||Math.abs(lat)>85)throw new JSONException("Invalid coordinate");
            if(i>0) { JSONArray prev=coords.getJSONArray(i-1); double d=NavigationProgress.distance(lon,lat,prev.getDouble(0),prev.getDouble(1));
                if(d>10000)throw new JSONException("Geometry discontinuity"); meters[i]=meters[i-1]+d; }
        }
        if(distance(coords.getJSONArray(0),start)>40||distance(coords.getJSONArray(coords.length()-1),end)>40)throw new JSONException("Invalid geometry endpoint");
        JSONArray legs=raw.getJSONArray("legs");if(legs.length()!=1)throw new JSONException("Unexpected legs");
        JSONArray steps=legs.getJSONObject(0).getJSONArray("steps"),turns=new JSONArray(),maneuvers=new JSONArray();
        if(steps.length()<2||steps.length()>2000)throw new JSONException("Missing steps");
        int cursor=0; boolean ko=language.startsWith("ko");
        for(int i=0;i<steps.length();i++) {
            JSONObject step=steps.getJSONObject(i),maneuver=step.getJSONObject("maneuver");
            JSONArray location=maneuver.getJSONArray("location");int index=-1;
            for(int j=cursor;j<coords.length();j++)if(distance(coords.getJSONArray(j),new double[]{location.getDouble(0),location.getDouble(1)})<3){index=j;break;}
            if(index<0)throw new JSONException("Maneuver off geometry"); cursor=index;
            String type=maneuver.getString("type"),modifier=maneuver.optString("modifier"),road=step.optString("name");
            if(road.length()>200)road=road.substring(0,200);
            String action=action(type,modifier,ko);
            if(type.contains("roundabout")||type.contains("rotary")) {
                int exit=maneuver.optInt("exit",0); if(exit>0&&exit<50)action+=(ko?", "+exit+"번째 출구":", take exit "+exit);
            }
            JSONArray segments=new JSONArray();String text;
            if(!road.isEmpty()) {
                String prefix=ko?"":action+" toward ",suffix=ko?" 방면 "+action:".";
                if(!prefix.isEmpty())segments.put(part(prefix,language));
                segments.put(part(road,ko&&road.matches(".*[A-Za-z].*")?"en-US":language));segments.put(part(suffix,language));
                text=prefix+road+suffix;
            } else { text=action;segments.put(part(text,language)); }
            turns.put(new JSONObject().put("type",type).put("progressMeters",meters[index]).put("text",text).put("segments",segments)
                .put("complex",type.contains("roundabout")||type.contains("rotary")||type.equals("off ramp")||type.equals("fork")));
            maneuvers.put(new JSONObject(maneuver.toString()).put("name",road).put("cumulativeDistance",meters[index]));
        }
        if(!"arrive".equals(turns.getJSONObject(turns.length()-1).optString("type")))throw new JSONException("Missing arrival");
        for(int i=0;i<turns.length()-1;i++){
            JSONObject turn=turns.getJSONObject(i),next=turns.getJSONObject(i+1);
            if("arrive".equals(next.optString("type")))continue;
            double after=next.getDouble("progressMeters")-turn.getDouble("progressMeters");
            if(after>=0&&after<=180)turn.put("complex",true).put("following",new JSONObject().put("distanceAfter",after).put("text",next.getString("text")).put("segments",next.getJSONArray("segments")));
        }
        return new JSONObject().put("coordinates",coords).put("turns",turns).put("maneuvers",maneuvers).put("geometryMeters",meters[meters.length-1]).put("rawRoute",raw);
    }
    private static JSONObject part(String text,String language)throws JSONException{return new JSONObject().put("text",text).put("lang",language);}
    private static double distance(JSONArray p,double[] expected)throws JSONException{double lon=p.getDouble(0),lat=p.getDouble(1);if(!NavigationProgress.finite(lon)||!NavigationProgress.finite(lat)||Math.abs(lon)>180||Math.abs(lat)>85)throw new JSONException("Invalid waypoint");return NavigationProgress.distance(lon,lat,expected[0],expected[1]);}
    static String action(String type,String modifier,boolean ko) {
        if("arrive".equals(type))return ko?"목적지 부근 도착":"Arrive near the destination";
        if(type.contains("roundabout")||type.contains("rotary"))return ko?"회전교차로 진입":"Enter the roundabout";
        if("uturn".equals(modifier))return ko?"유턴":"Make a U-turn";
        String direction=modifier.contains("left")?(ko?"왼쪽":"left"):modifier.contains("right")?(ko?"오른쪽":"right"):(ko?"직진":"straight");
        if("off ramp".equals(type))return ko?direction+" 출구로 진출":"Take the exit "+direction;
        if("fork".equals(type))return ko?direction+" 갈림길로 진행":"Keep "+direction+" at the fork";
        if("merge".equals(type)||"on ramp".equals(type))return ko?direction+" 합류":"Merge "+direction;
        if(modifier.contains("left")||modifier.contains("right"))return ko?direction+"으로 회전":"Turn "+direction;
        return ko?"계속 진행":"Continue straight";
    }
}
