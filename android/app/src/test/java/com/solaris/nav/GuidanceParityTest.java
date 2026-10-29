package com.solaris.nav;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.nio.file.Files;
import java.nio.file.Paths;
import static org.junit.Assert.*;

/** The same road/fix fixtures are consumed by the foreground JS tests. */
public class GuidanceParityTest {
    private double[][] matrix(JSONArray a) throws Exception {
        double[][] result=new double[a.length()][];
        for(int i=0;i<a.length();i++){JSONArray row=a.getJSONArray(i);result[i]=new double[row.length()];for(int j=0;j<row.length();j++)result[i][j]=row.getDouble(j);}
        return result;
    }
    @Test public void backgroundMatchesSharedForegroundDecisionsWithoutExtraFixDelay() throws Exception {
        JSONArray scenarios=new JSONArray(new String(Files.readAllBytes(Paths.get(System.getProperty("navigation.parity.fixtures"))),java.nio.charset.StandardCharsets.UTF_8));
        for(int i=0;i<scenarios.length();i++) {
            JSONObject scenario=scenarios.getJSONObject(i);NavigationProgress matcher=new NavigationProgress(matrix(scenario.getJSONArray("points")));
            if(scenario.has("edges")) {
                JSONArray rows=scenario.getJSONArray("successors");int[][] links=new int[rows.length()][];
                for(int n=0;n<rows.length();n++){JSONArray row=rows.getJSONArray(n);links[n]=new int[row.length()];for(int j=0;j<row.length();j++)links[n][j]=row.getInt(j);}
                matcher.setNearbyRoads(matrix(scenario.getJSONArray("edges")),scenario.optLong("expiresAt",200000),links);
            }
            JSONArray fixes=scenario.getJSONArray("fixes");
            for(int n=0;n<fixes.length();n++) {
                JSONObject f=fixes.getJSONObject(n);long at=f.getLong("at");
                double p=matcher.match(f.getDouble("lng"),f.getDouble("lat"),f.optDouble("accuracy",5),f.optDouble("heading",90),f.optDouble("speed",10),at,at);
                assertEquals(scenario.getString("name")+" fix "+n,f.getBoolean("expected"),Double.isFinite(p));
            }
        }
    }
}
