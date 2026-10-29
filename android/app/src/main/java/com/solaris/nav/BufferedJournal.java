package com.solaris.nav;

import java.io.*;
import java.nio.charset.StandardCharsets;

/** Single IO-thread owner. Small samples batch at 64 KiB; larger events flush immediately. */
final class BufferedJournal {
    private final File directory;
    private final int chunkBytes, batchBytes;
    private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    private int bufferedRecords;
    long failedRecords;
    BufferedJournal(File directory, int chunkBytes, int batchBytes) {
        this.directory = directory; this.chunkBytes = chunkBytes; this.batchBytes = batchBytes;
    }
    void append(String line) throws IOException {
        byte[] bytes = line.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > chunkBytes) { failedRecords++; throw new IOException("Record too large"); }
        if (buffer.size() + bytes.length > batchBytes) {
            try { flush(); } catch (IOException error) { failedRecords++; throw error; }
        }
        buffer.write(bytes); bufferedRecords++;
        if (buffer.size() >= batchBytes) flush();
    }
    void flush() throws IOException {
        if (buffer.size() == 0) return;
        try {
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Journal unavailable");
            File current = new File(directory, "0.jsonl");
            if (current.length() + buffer.size() > chunkBytes) {
                File oldest = new File(directory, "3.jsonl");
                if (oldest.exists() && !oldest.delete()) throw new IOException("Rotation failed");
                for (int i = 2; i >= 0; i--) {
                    File from = new File(directory, i + ".jsonl");
                    if (from.exists() && !from.renameTo(new File(directory, (i + 1) + ".jsonl"))) throw new IOException("Rotation failed");
                }
            }
            try (FileOutputStream stream = new FileOutputStream(current, true)) { buffer.writeTo(stream); }
        } catch (IOException error) { failedRecords += bufferedRecords; throw error; }
        finally { buffer.reset(); bufferedRecords = 0; }
    }
    void discard() { buffer.reset(); bufferedRecords = 0; }
}
