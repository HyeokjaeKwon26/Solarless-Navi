package com.solaris.nav;

/** Pure route matcher used by the background service and JVM regression tests. */
final class NavigationProgress {
    private final double[][] points;
    private final double[] meters;
    private double last = -1;
    private long lastAt;
    private boolean uncertain;
    private double pending = -1;
    private long pendingAt;
    private double[][] nearbyRoads = new double[0][];
    private long nearbyExpiresAt;
    private int[][] successors;
    private int[] priorNearby = new int[0];
    private long nearbyAt;
    void setNearbyRoads(double[][] edges, long expiresAt) { setNearbyRoads(edges, expiresAt, null); }
    void setNearbyRoads(double[][] edges, long expiresAt, int[][] links) {
        nearbyRoads = edges; nearbyExpiresAt = expiresAt; successors = links;
        priorNearby = new int[0]; nearbyAt = 0;
    }
    private boolean nearbyConflict(double lon, double lat, double heading, double speed, double accuracy, double routeLon, double routeLat, long now) {
        if (now > nearbyExpiresAt) { priorNearby = new int[0]; return false; }
        boolean continuous = now > nearbyAt && now-nearbyAt <= 8000;
        java.util.ArrayList<double[]> candidates = new java.util.ArrayList<>();
        for (int id=0; id<nearbyRoads.length; id++) {
            double[] e = nearbyRoads[id];
            double diff = finite(heading) && speed*3.6 >= 8 ? Math.abs((heading-e[4]+540)%360-180) : 0;
            if (diff > 65) continue;
            double cos = Math.cos(Math.toRadians(lat)), dx=(e[2]-e[0])*cos, dy=e[3]-e[1];
            double t=Math.max(0,Math.min(1,((lon-e[0])*cos*dx+(lat-e[1])*dy)/Math.max(1e-20,dx*dx+dy*dy)));
            double x=e[0]+t*(e[2]-e[0]), y=e[1]+t*(e[3]-e[1]), d=distance(lon,lat,x,y);
            if(d>25) continue;
            boolean connected=false;
            if(continuous) for(int prior:priorNearby) {
                if(prior==id) connected=true;
                if(successors!=null && prior<successors.length) for(int next:successors[prior]) if(next==id) connected=true;
            }
            if (d<=25) candidates.add(new double[]{x,y,d,d+diff*.12+(successors!=null&&continuous&&priorNearby.length>0&&!connected?18:0),e[5],id});
        }
        nearbyAt=now;
        if(candidates.isEmpty()) { priorNearby=new int[0]; return false; }
        java.util.Collections.sort(candidates,(a,b)->Double.compare(a[3],b[3]));
        priorNearby=new int[Math.min(6,candidates.size())];
        for(int i=0;i<priorNearby.length;i++) priorNearby[i]=(int)candidates.get(i)[5];
        double[] best=candidates.get(0);
        for(int i=0;i<priorNearby.length;i++) { double[] other=candidates.get(i); if(other[4]!=best[4] && distance(other[0],other[1],best[0],best[1])>5) {
            if(other[3]-best[3]<Math.max(6,accuracy*.6)) return true;
            break;
        } }
        return distance(best[0],best[1],routeLon,routeLat)>Math.max(10,accuracy) && best[2]+Math.max(6,accuracy*.5)<distance(lon,lat,routeLon,routeLat);
    }
    // lon, lat, timestamp, route progress, accuracy, cumulative raw travel.
    private final java.util.ArrayList<double[]> history = new java.util.ArrayList<>();
    NavigationProgress(double[][] points) {
        this.points = points;
        meters = new double[points.length];
        for (int i = 1; i < points.length; i++) meters[i] = meters[i - 1] + distance(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    }
    static boolean finite(double value) { return !Double.isNaN(value) && !Double.isInfinite(value); }
    static double distance(double lon1, double lat1, double lon2, double lat2) {
        return Math.hypot((lon2 - lon1) * Math.cos(Math.toRadians((lat1 + lat2) / 2)), lat2 - lat1) * 111194.9266;
    }
    double match(double lon, double lat, double accuracy, double heading, double speed, long at, long now) {
        if (!finite(lon) || !finite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90 || !finite(speed) || speed < 0 || !finite(accuracy) || accuracy <= 0 || accuracy > 35 || now - at > 10000 || at - now > 2000 || at <= lastAt || (pending >= 0 && at <= pendingAt)) return Double.NaN;
        boolean continuous = last >= 0 && at - lastAt <= 15000;
        while (!history.isEmpty() && (!continuous || at - history.get(0)[2] > 8000)) history.remove(0);
        double travelled = history.isEmpty() ? 0 : history.get(history.size()-1)[5] + distance(lon, lat, history.get(history.size()-1)[0], history.get(history.size()-1)[1]);
        double[] anchor = !history.isEmpty() && at - history.get(0)[2] >= 2000 ? history.get(0) : null;
        boolean motionConflict = false;
        double allowance = Math.max(45, speed * Math.max(0, at - lastAt) / 1000 * 1.8 + accuracy * 2);
        double best = Double.POSITIVE_INFINITY, bestDistance=Double.POSITIVE_INFINITY, progress = -1, routeLon=lon, routeLat=lat;
        java.util.ArrayList<double[]> candidates = new java.util.ArrayList<>();
        for (int i = 0; i < points.length - 1; i++) {
            double[] a = points[i], b = points[i + 1];
            double cos = Math.cos(Math.toRadians(lat)), dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
            double t = Math.max(0, Math.min(1, ((lon - a[0]) * cos * dx + (lat - a[1]) * dy) / Math.max(1e-20, dx * dx + dy * dy)));
            double d = distance(lon, lat, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
            if (d > 40) continue;
            double p = meters[i] + t * (meters[i + 1] - meters[i]);
            if (continuous && (p < last - 20 || p > last + allowance)) continue;
            double bearing = (Math.toDegrees(Math.atan2(dx, dy)) + 360) % 360;
            double diff = finite(heading) && speed >= 2.2 ? Math.abs((heading - bearing + 540) % 360 - 180) : 0;
            if (diff > 110) continue;
            double moved = anchor == null ? 0 : travelled - anchor[5];
            if (anchor != null && Math.abs(p-anchor[3]) > moved*1.5 + accuracy + anchor[4] + 15) { motionConflict = true; continue; }
            double residual = anchor == null ? 0 : Math.abs(Math.max(0, p-anchor[3])-moved);
            double score = d + diff * 0.15 + (continuous ? Math.max(0,last-p)*0.5 : 0) + Math.min(12,residual*0.2);
            candidates.add(new double[]{p, score});
            if (score < best) { best = score; bestDistance=d; progress = p; routeLon=a[0]+t*(b[0]-a[0]); routeLat=a[1]+t*(b[1]-a[1]); }
        }
        boolean conflict=nearbyConflict(lon,lat,heading,speed,accuracy,routeLon,routeLat,at);
        if (progress < 0) { if (motionConflict) uncertain = true; pending = -1; return Double.NaN; }
        if (conflict) { uncertain=true; pending=-1; return Double.NaN; }
        for (double[] candidate : candidates) if (Math.abs(candidate[0] - progress) > 60 && candidate[1] - best < Math.max(8, accuracy * 0.6)) {
            uncertain = true; pending = -1; return Double.NaN;
        }
        if(bestDistance>Math.min(40,Math.max(18,accuracy*1.5))) { if(motionConflict) uncertain=true; pending=-1; return Double.NaN; }
        if (uncertain || (last >= 0 && at - lastAt > 15000)) {
            long elapsed = at - pendingAt;
            double recoveryAllowance = Math.max(45, speed * Math.max(0, elapsed) / 1000 * 1.8 + accuracy * 2);
            if (!(pending >= 0 && elapsed > 0 && elapsed <= 5000 && progress >= pending - 20 && progress <= pending + recoveryAllowance)) {
                pending = progress; pendingAt = at; return Double.NaN;
            }
        }
        uncertain = false; pending = -1;
        last = progress; lastAt = at;
        history.add(new double[]{lon,lat,at,progress,accuracy,travelled});
        while (history.size()>32) history.remove(0);
        return progress;
    }
    static int phase(double distance, double speed) {
        return phase(distance, speed, false);
    }
    static int phase(double distance, double speed, boolean complex) {
        if (distance < -8) return 0;
        if (distance <= Math.max(20, Math.min(60, speed * 2))) return 3;
        if (distance <= Math.max(90, Math.min(complex ? 450 : 400, speed * (complex ? 14 : 10)))) return 2;
        if (distance <= Math.max(250, Math.min(complex ? 1200 : 1000, speed * (complex ? 30 : 25)))) return 1;
        return 0;
    }
}
