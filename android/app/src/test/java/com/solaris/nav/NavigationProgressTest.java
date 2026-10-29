package com.solaris.nav;
import org.junit.Test;
import static org.junit.Assert.*;

public class NavigationProgressTest {
    @Test public void nearbyParallelRoadsDeferGuidanceAndReacquireAfterTwoClearFixes() {
        NavigationProgress p=new NavigationProgress(new double[][]{{0,0},{.01,0}});
        p.setNearbyRoads(new double[][]{{0,0,.01,0,90,11},{0,.00016,.01,.00016,90,12}},200000);
        assertTrue(Double.isNaN(p.match(.001,.00008,20,90,10,100000,100000)));
        assertTrue(Double.isNaN(p.match(.0011,0,3,90,10,101000,101000)));
        assertTrue(p.match(.0012,0,3,90,10,102000,102000)>100);
    }
    @Test public void nearbyEvidenceExpiresAndDoesNotInventConnections() {
        NavigationProgress p=new NavigationProgress(new double[][]{{0,0},{.01,0}});
        p.setNearbyRoads(new double[][]{{0,.00016,.01,.00016,90,12}},200000);
        assertTrue(Double.isNaN(p.match(.001,.00016,3,90,10,100000,100000)));
        NavigationProgress expired=new NavigationProgress(new double[][]{{0,0},{.01,0}});
        expired.setNearbyRoads(new double[][]{{0,.00016,.01,.00016,90,12}},99999);
        assertTrue(expired.match(.001,0,3,90,10,100000,100000)>0);
    }
    @Test public void trajectoryRejectsShortcutOntoLaterLoopDespiteHighReportedSpeed() {
        NavigationProgress p=new NavigationProgress(new double[][]{{0,0},{.00027,0},{.00027,.00009},{0,.00009},{0,.00018},{.002,.00018}});
        assertTrue(p.match(0,0,5,90,50,10000,10000)>=0);
        assertTrue(p.match(.00004,0,5,90,50,11000,11000)>0);
        assertTrue(Double.isNaN(p.match(.00004,.00018,5,90,50,12000,12000)));
        assertTrue(Double.isNaN(p.match(.00006,0,5,90,50,13000,13000)));
        assertTrue(p.match(.00008,0,5,90,50,14000,14000)<10);
    }
    @Test public void frequentFixesKeepNormalProgressAndTurns() {
        NavigationProgress p=line();double progress=0;
        for(int i=0;i<40;i++){progress=p.match(-70.999+i*.00002,40,5,90,10,10000+i*250,10000+i*250);assertTrue(Double.isFinite(progress));}
        assertTrue(progress>100);
    }
    @Test public void complexJunctionPreparesEarlierWithoutEarlyExecution() {
        assertEquals(1,NavigationProgress.phase(350,28,false));
        assertEquals(2,NavigationProgress.phase(350,28,true));
        assertEquals(0,NavigationProgress.phase(800,28,false));
        assertEquals(1,NavigationProgress.phase(800,28,true));
        assertEquals(3,NavigationProgress.phase(55,28,true));
    }
    private NavigationProgress line() { return new NavigationProgress(new double[][]{{-71,40},{-70.99,40}}); }
    @Test public void rejectsStaleInaccurateAndOppositeFixes() {
        assertTrue(Double.isNaN(line().match(-70.999,40,50,90,10,100000,100000)));
        assertTrue(Double.isNaN(line().match(-70.999,40,5,90,10,80000,100000)));
        assertTrue(Double.isNaN(line().match(-70.999,40,5,270,10,100000,100000)));
        assertTrue(Double.isNaN(line().match(-70.999,40,Double.NaN,90,10,100000,100000)));
    }
    @Test public void progressRejectsImpossibleJumpButReacquiresAfterGap() {
        NavigationProgress p=line();
        assertTrue(p.match(-70.999,40,5,90,10,100000,100000)>0);
        assertTrue(Double.isNaN(p.match(-70.991,40,5,90,10,101000,101000)));
        assertTrue(Double.isNaN(p.match(-70.991,40,5,90,10,120000,120000)));
        assertTrue(Double.isNaN(p.match(-70.991,40,5,90,10,120000,120000)));
        assertTrue(Double.isNaN(p.match(-70.991,40,5,90,10,119999,120000)));
        assertTrue(p.match(-70.9909,40,5,90,10,121000,121000)>700);
        assertTrue(Double.isNaN(p.match(-70.9909,40,5,90,10,121000,121000)));
    }
    @Test public void rejectsInvalidCoordinatesAccuracyAndSpeed() {
        assertTrue(Double.isNaN(line().match(-71,91,5,90,10,100000,100000)));
        assertTrue(Double.isNaN(line().match(-71,40,0,90,10,100000,100000)));
        assertTrue(Double.isNaN(line().match(-71,40,5,90,Double.NaN,100000,100000)));
    }
    @Test public void inaccurateParallelRoadMatchNeedsClearSeparationAndTwoFixes() {
        NavigationProgress p=new NavigationProgress(new double[][]{{0,0},{0.01,0},{0.01,0.001},{0,0.001},{0,0.0002},{0.01,0.0002}});
        assertTrue(Double.isNaN(p.match(0.005,0.00004,30,90,10,100000,100000)));
        assertTrue(Double.isNaN(p.match(0.005,0,5,90,10,101000,101000)));
        assertTrue(p.match(0.0051,0,5,90,10,102000,102000)>500);
    }
    @Test public void ambiguousRepeatedRoadDoesNotSpeakWrongTurn() {
        NavigationProgress p=new NavigationProgress(new double[][]{{-71,40},{-70.99,40},{-71,40},{-70.99,40}});
        assertTrue(Double.isNaN(p.match(-70.995,40,5,90,10,100000,100000)));
    }
    @Test public void speedChangesAdvanceWarningButKeepsExecutionBounded() {
        assertEquals(0,NavigationProgress.phase(600,5));
        assertEquals(1,NavigationProgress.phase(600,30));
        assertEquals(2,NavigationProgress.phase(250,30));
        assertEquals(3,NavigationProgress.phase(55,30));
        assertEquals(0,NavigationProgress.phase(-20,30));
    }
}
