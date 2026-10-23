package com.solaris.nav;
import org.junit.Test;
import static org.junit.Assert.*;

public class NavigationProgressTest {
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
        assertTrue(p.match(-70.991,40,5,90,10,120000,120000)>700);
        assertTrue(Double.isNaN(p.match(-70.991,40,5,90,10,120000,120000)));
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
