package com.solaris.nav;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;

public class BackgroundRecoveryTest {
    @Test public void requiresSustainedAccurateMovementNotAdjacentRoadNoise() {
        BackgroundRecovery p=new BackgroundRecovery();
        assertFalse(p.observe(90,5,10,100000,100000));assertFalse(p.observe(90,5,10,102000,102000));
        assertFalse(p.observe(90,5,10,104000,104000));assertTrue(p.observe(90,5,10,108000,108000));
        long token=p.begin(108000);assertFalse(p.observe(90,5,10,110000,110000));assertTrue(p.current(token));
        assertFalse(p.observe(30,5,10,111000,111000));assertFalse(p.current(token));
        for(double accuracy:new double[]{0,26,Double.NaN})assertFalse(p.observe(90,accuracy,10,120000,120000));
        assertFalse(p.observe(90,5,0,121000,121000));assertFalse(p.observe(90,5,10,121000,140000));
    }
    @Test public void staleResponsesCannotReplaceRoutesAndFailuresBackOff() {
        BackgroundRecovery p=new BackgroundRecovery();long token=p.begin(100000);
        assertTrue(p.accepts(token,true,7,7,100000,104000,105000,50));
        assertFalse(p.accepts(token,false,7,7,100000,104000,105000,50));
        assertFalse(p.accepts(token,true,7,8,100000,104000,105000,50));
        assertFalse(p.accepts(token,true,7,7,100000,104000,135000,50));
        assertFalse(p.accepts(token,true,7,7,100000,104000,105000,151));
        p.finish(token,105000,false);
        for(int i=0;i<6;i++)assertFalse(p.observe(90,5,10,140000+i*2000,140000+i*2000));
        assertFalse(p.observe(90,5,10,165000,165000));
        assertFalse(p.observe(90,5,10,167000,167000));assertFalse(p.observe(90,5,10,169000,169000));assertTrue(p.observe(90,5,10,173000,173000));
        long second=p.begin(173000);p.reset();assertFalse(p.current(second));
    }
    @Test public void geometryDistanceDoesNotTreatProjectionExtensionAsRoad() {
        double[][] coords={{0,0},{.001,0}};
        assertEquals(0,BackgroundRecovery.distanceToPath(.0005,0,coords),.01);
        assertTrue(BackgroundRecovery.distanceToPath(.002,0,coords)>100);
    }
    private JSONObject response()throws Exception {
        return new JSONObject("{\"code\":\"Ok\",\"waypoints\":[{\"location\":[0,0]},{\"location\":[0.002,0]}],\"routes\":[{\"duration\":30,\"distance\":222,\"geometry\":{\"coordinates\":[[0,0],[0.001,0],[0.002,0]]},\"legs\":[{\"steps\":[{\"name\":\"Lee St.\",\"maneuver\":{\"type\":\"depart\",\"location\":[0,0]}},{\"name\":\"Harvard Avenue\",\"maneuver\":{\"type\":\"turn\",\"modifier\":\"left\",\"location\":[0.001,0]}},{\"maneuver\":{\"type\":\"arrive\",\"location\":[0.002,0]}}]}]}]}");
    }
    @Test public void recoveryBuildsGeometricTurnPositionsAndUsesExistingLanguagePlan()throws Exception {
        JSONObject result=RecoveryRoute.parse(response(),new double[]{0,0},new double[]{.002,0},"ko-KR");
        JSONObject turn=result.getJSONArray("turns").getJSONObject(1);
        assertEquals(111,turn.getDouble("progressMeters"),2);assertTrue(turn.getString("text").contains("Harvard Avenue"));
        assertEquals("en-US",turn.getJSONArray("segments").getJSONObject(0).getString("lang"));
        assertTrue(result.has("rawRoute"));assertFalse(result.has("glare"));
    }
    @Test public void rejectsNoRouteDistantSnapAndManeuversOutsideGeometry()throws Exception {
        JSONObject body=response();body.put("code","NoRoute");reject(body);
        body=response();body.getJSONArray("waypoints").getJSONObject(1).put("location",new JSONArray("[0.01,0]"));reject(body);
        body=response();body.getJSONArray("routes").getJSONObject(0).getJSONArray("legs").getJSONObject(0).getJSONArray("steps").getJSONObject(1).getJSONObject("maneuver").put("location",new JSONArray("[0.001,0.001]"));reject(body);
        body=response();body.getJSONArray("routes").getJSONObject(0).put("duration",-1);reject(body);
    }
    private void reject(JSONObject body)throws Exception {try{RecoveryRoute.parse(body,new double[]{0,0},new double[]{.002,0},"en-US");fail("Accepted invalid route");}catch(JSONException expected){}}
}
