package com.solaris.nav;
import org.junit.Test;
import org.json.*;
import static org.junit.Assert.*;

public class SpeechPlaybackTest {
    @Test public void delayedBridgeRequestsMustMatchCurrentOwnerAndTurn() {
        SpeechTurnPolicy t=new SpeechTurnPolicy();t.update("old",false);t.update("native",true);
        t.update("new",false);assertFalse(t.accepts("old",false));assertTrue(t.accepts("new",false));
        assertTrue(t.accepts("native",true));assertFalse(t.accepts("new",true));
        t.update("",false);assertFalse(t.accepts("new",false));assertTrue(t.accepts("",false));
    }
    @Test public void recordsStartDelayAndWholeGroupCompletion() throws Exception {
        SpeechPlayback p=new SpeechPlayback();p.begin("nav-1-","nav-1-2",100,false);
        assertTrue(p.start("nav-1-0",350));assertTrue(p.start("nav-1-1",7000));
        assertFalse(p.done("nav-1-1",8000));assertTrue(p.done("nav-1-2",9000));
        JSONObject s=p.snapshot();assertEquals(1,s.getInt("started"));assertEquals(1,s.getInt("completed"));
        assertEquals(250,s.getJSONArray("events").getJSONObject(1).getLong("startDelayMs"));
    }
    @Test public void engineStartAfterDeadlineCannotReviveExpiredSpeech() throws Exception {
        SpeechPlayback p=new SpeechPlayback();p.begin("nav-1-","nav-1-0",0,false);
        assertFalse(p.start("nav-1-0",4000));assertFalse(p.active());
        assertFalse(p.done("nav-1-0",5000));assertEquals(1,p.snapshot().getInt("expired"));
    }
    @Test public void staleCallbacksCannotStopNewGroup() throws Exception {
        SpeechPlayback p=new SpeechPlayback();p.begin("nav-1-","nav-1-0",0,false);
        p.cancel("turn-changed",100);p.begin("nav-2-","nav-2-0",200,true);
        assertFalse(p.error("nav-1-0",300));assertFalse(p.start("nav-1-0",300));
        assertTrue(p.start("nav-2-0",400));assertTrue(p.active());
        assertEquals(1,p.snapshot().getInt("cancelled"));assertEquals(0,p.snapshot().getInt("errors"));
    }
    @Test public void neverStartedAndNeverCompletedRequestsAreBounded() throws Exception {
        SpeechPlayback p=new SpeechPlayback();p.begin("a-","a-0",0,false);assertFalse(p.timeout(3999));assertTrue(p.timeout(4000));
        p.begin("b-","b-0",5000,true);p.start("b-0",5200);assertFalse(p.timeout(65199));assertTrue(p.timeout(65200));
        assertEquals(2,p.snapshot().getInt("expired"));
    }
    @Test public void missingStartIsNotInventedAndEventStorageIsBounded() throws Exception {
        SpeechPlayback p=new SpeechPlayback();p.begin("a-","a-0",0,false);p.done("a-0",100);
        assertEquals(1,p.snapshot().getInt("missingStart"));assertEquals(0,p.snapshot().getInt("started"));
        for(int i=0;i<100;i++){p.begin("g"+i+"-","g"+i+"-0",i*10,true);p.error("g"+i+"-0",i*10+1);}
        assertEquals(48,p.snapshot().getJSONArray("events").length());assertEquals(100,p.snapshot().getInt("errors"));
        assertFalse(p.snapshot().toString().contains("text"));
    }
}
