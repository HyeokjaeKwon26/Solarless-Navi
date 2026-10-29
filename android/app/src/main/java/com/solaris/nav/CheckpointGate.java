package com.solaris.nav;

/** Uses monotonic elapsed time; live samples are never throttled. */
final class CheckpointGate {
    private long savedAt = -1;
    boolean due(long elapsedMs) { return savedAt < 0 || elapsedMs < savedAt || elapsedMs - savedAt >= 2000; }
    void saved(long elapsedMs) { savedAt = elapsedMs; }
    void reset() { savedAt = -1; }
}
