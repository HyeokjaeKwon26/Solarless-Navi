package com.solaris.nav;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import java.util.*;
public class RecoveryPreferenceTest {
    private JSONObject route(double duration,int count)throws Exception {
        JSONArray steps=new JSONArray();for(int i=0;i<count;i++)steps.put(new JSONObject().put("distance",200).put("maneuver",new JSONObject().put("type","turn").put("modifier","left")));
        return new JSONObject().put("coordinates",new JSONArray("[[0,0],[0.001,0]]")).put("geometryMeters",111.195).put("rawRoute",new JSONObject().put("duration",duration).put("legs",new JSONArray().put(new JSONObject().put("steps",steps))));
    }
    private JSONObject policy(String mode)throws Exception{return new JSONObject().put("mode",mode).put("budgetSeconds",300).put("createdAt",100000);}
    @Test public void easierRouteRespectsExtraTimeAndUturnLimits()throws Exception{
        JSONObject a=route(100,5),b=route(115,2);assertSame(b,RecoveryPreference.choose(new ArrayList<>(Arrays.asList(a,b)),policy("simple"),100000));
        b=route(150,1);assertSame(a,RecoveryPreference.choose(new ArrayList<>(Arrays.asList(a,b)),policy("simple"),100000));
        b=route(110,1);b.getJSONObject("rawRoute").getJSONArray("legs").getJSONObject(0).getJSONArray("steps").getJSONObject(0).getJSONObject("maneuver").put("modifier","uturn");
        assertSame(a,RecoveryPreference.choose(new ArrayList<>(Arrays.asList(a,b)),policy("simple"),100000));
    }
    @Test public void missingExpiredOrReverseSunDataCannotBeUsed()throws Exception{
        JSONObject r=route(30,1),p=policy("glareFree");assertNull(RecoveryPreference.exposure(r,null,100000));
        p.put("segments",new JSONArray("[[0.001,0,0,0,0.1,0.9,100000]]"));assertNull(RecoveryPreference.exposure(r,p.getJSONArray("segments"),100000));
        p.put("segments",new JSONArray("[[0,0,0.001,0,0.1,0.9,100000]]"));assertNotNull(RecoveryPreference.exposure(r,p.getJSONArray("segments"),100000));
        assertNull(RecoveryPreference.exposure(r,p.getJSONArray("segments"),300000));
        assertEquals("sun-evidence-unavailable",RecoveryPreference.choose(new ArrayList<>(Arrays.asList(r)),p,800000).getString("recoveryReason"));
    }
    @Test public void parallelOrPartlyUnanalysedRoadCannotInheritSunEvidence()throws Exception{
        JSONObject r=route(30,1);assertNull(RecoveryPreference.exposure(r,new JSONArray("[[0,0.0001,0.001,0.0001,0,1,100000]]"),100000));
        assertNull(RecoveryPreference.exposure(r,new JSONArray("[[0,0,0.0003,0,0,1,100000]]"),100000));
    }
    @Test public void sunAlternativeRequiresComparableEvidenceAndMeaningfulBenefit()throws Exception{
        JSONObject a=route(100,1),b=route(110,1);b.put("coordinates",new JSONArray("[[0,0.001],[0.001,0.001]]"));
        JSONObject p=policy("glareFree").put("segments",new JSONArray("[[0,0,0.001,0,0.8,0.1,140000],[0,0.001,0.001,0.001,0.1,0.9,140000]]"));
        assertSame(b,RecoveryPreference.choose(new ArrayList<>(Arrays.asList(a,b)),p,100000));
        assertEquals("cached-sun-comparison",b.getString("recoveryReason"));p.put("budgetSeconds",0);
        assertSame(a,RecoveryPreference.choose(new ArrayList<>(Arrays.asList(a,b)),p,100000));
    }
}
