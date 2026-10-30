package com.solaris.nav;

/** Reject a bridge request that arrives after its maneuver has changed. */
final class SpeechTurnPolicy {
    private String foreground="", background="";
    void update(String key,boolean fromBackground) {
        if(fromBackground)background=key;else foreground=key;
    }
    boolean accepts(String key,boolean fromBackground) {
        return key==null||key.isEmpty()||key.equals(fromBackground?background:foreground);
    }
}
