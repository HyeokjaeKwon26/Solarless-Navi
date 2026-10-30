package com.solaris.nav;

/** No location requests: consumes the foreground service's existing fixes. */
final class BackgroundRecovery {
    private long since, last, nextAttempt, generation;
    private int count, failures;
    private boolean pending;
    long reset() { since=last=0; count=0; pending=false; return ++generation; }
    boolean observe(double distance, double accuracy95, double speed, long at, long now) {
        if (!NavigationProgress.finite(distance) || !NavigationProgress.finite(accuracy95) || accuracy95<=0 || accuracy95>25 ||
                now-at>10000 || at>now+2000 || at<=last || speed<1.5 || distance<Math.max(65,accuracy95*2)) {
            reset(); return false;
        }
        if (last==0 || at-last>10000) { since=at; count=0; }
        last=at; count++;
        return !pending && now>=nextAttempt && count>=4 && at-since>=8000;
    }
    long begin(long now) { pending=true; nextAttempt=now+30000; return ++generation; }
    boolean current(long token) { return pending && generation==token; }
    boolean accepts(long token,boolean background,long requestedRevision,long currentRevision,long requestedAt,long fixAt,long now,double moved) {
        return current(token)&&background&&requestedRevision==currentRevision&&now>=requestedAt&&now-requestedAt<=30000&&
            now-fixAt>=-2000&&now-fixAt<=10000&&NavigationProgress.finite(moved)&&moved<=150;
    }
    void finish(long token, long now, boolean success) {
        if (!current(token)) return;
        pending=false; failures=success?0:Math.min(3,failures+1);
        nextAttempt=now+(success?30000:Math.min(240000,30000L*(1L<<failures)));
        since=last=0; count=0;
    }
    static double distanceToPath(double lon,double lat,double[][] points) {
        double best=Double.POSITIVE_INFINITY,c=Math.cos(lat*Math.PI/180);
        for(int i=1;i<points.length;i++) {
            double[] a=points[i-1],b=points[i];
            double x=(b[0]-a[0])*c,y=b[1]-a[1],den=x*x+y*y;
            double t=den==0?0:Math.max(0,Math.min(1,((lon-a[0])*c*x+(lat-a[1])*y)/den));
            best=Math.min(best,NavigationProgress.distance(lon,lat,a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])));
        }
        return best;
    }
}
