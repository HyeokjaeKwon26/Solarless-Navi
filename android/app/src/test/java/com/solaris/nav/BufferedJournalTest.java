package com.solaris.nav;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class BufferedJournalTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    @Test public void samplesBatchAndFlushPreservesUnicodeAndOrder() throws Exception {
        File dir=temp.newFolder(); BufferedJournal log=new BufferedJournal(dir,2048,1024);
        StringBuilder expected=new StringBuilder();
        for(int i=0;i<20;i++){String line="{\"road\":\"길 "+i+"\"}\n";expected.append(line);log.append(line);}
        assertFalse(new File(dir,"0.jsonl").exists());
        log.flush();assertEquals(expected.toString(),read(new File(dir,"0.jsonl")));
        log.flush();assertEquals(expected.toString(),read(new File(dir,"0.jsonl")));
    }
    @Test public void rotationKeepsFourBoundedChunksWithoutSplittingRecords() throws Exception {
        File dir=temp.newFolder();BufferedJournal log=new BufferedJournal(dir,64,16);
        for(int i=0;i<30;i++)log.append(String.format("{\"value\":\"%020d\"}\n",i));
        log.flush();assertEquals(4,dir.listFiles().length);
        StringBuilder all=new StringBuilder();for(int i=3;i>=0;i--){File f=new File(dir,i+".jsonl");assertTrue(f.length()<=64);all.append(read(f));}
        String[] lines=all.toString().split("\n");assertEquals(4,lines.length);
        for(int i=0;i<4;i++)assertTrue(lines[i].contains(String.format("%020d",26+i)));
    }
    @Test public void discardAndWriteFailureDoNotResurrectPendingRecords() throws Exception {
        File dir=temp.newFolder();BufferedJournal log=new BufferedJournal(dir,1024,512);
        log.append("old\n");log.discard();log.flush();assertFalse(new File(dir,"0.jsonl").exists());
        File blocker=temp.newFile();BufferedJournal broken=new BufferedJournal(blocker,1024,512);
        broken.append("a\n");broken.append("b\n");try{broken.flush();fail();}catch(IOException expected){}
        assertEquals(2,broken.failedRecords);broken.flush();assertEquals(2,broken.failedRecords);
    }
    @Test public void checkpointUsesMonotonicTimeAndNeverFiltersLiveSamples() {
        CheckpointGate gate=new CheckpointGate();int writes=0;
        for(long t=0;t<10000;t+=250)if(gate.due(t)){writes++;gate.saved(t);}
        assertEquals(5,writes);assertFalse(gate.due(9999));assertTrue(gate.due(10000));
        gate.reset();assertTrue(gate.due(10000));
    }
    private String read(File f) throws IOException {return new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8);}
}
