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
        double allowance = Math.max(45, speed * Math.max(0, at - lastAt) / 1000 * 1.8 + accuracy * 2);
        double best = Double.POSITIVE_INFINITY, progress = -1;
        java.util.ArrayList<double[]> candidates = new java.util.ArrayList<>();
        for (int i = 0; i < points.length - 1; i++) {
            double[] a = points[i], b = points[i + 1];
            double cos = Math.cos(Math.toRadians(lat)), dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
            double t = Math.max(0, Math.min(1, ((lon - a[0]) * cos * dx + (lat - a[1]) * dy) / Math.max(1e-20, dx * dx + dy * dy)));
            double d = distance(lon, lat, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
            if (d > Math.min(40, Math.max(18, accuracy * 1.5))) continue;
            double p = meters[i] + t * (meters[i + 1] - meters[i]);
            if (continuous && (p < last - 20 || p > last + allowance)) continue;
            double bearing = (Math.toDegrees(Math.atan2(dx, dy)) + 360) % 360;
            double diff = finite(heading) && speed >= 2.2 ? Math.abs((heading - bearing + 540) % 360 - 180) : 0;
            if (diff > 110) continue;
            double score = d + diff * 0.15;
            candidates.add(new double[]{p, score});
            if (score < best) { best = score; progress = p; }
        }
        if (progress < 0) { pending = -1; return Double.NaN; }
        for (double[] candidate : candidates) if (Math.abs(candidate[0] - progress) > 60 && candidate[1] - best < Math.max(8, accuracy * 0.6)) {
            uncertain = true; pending = -1; return Double.NaN;
        }
        if (uncertain || (last >= 0 && at - lastAt > 15000)) {
            long elapsed = at - pendingAt;
            double recoveryAllowance = Math.max(45, speed * Math.max(0, elapsed) / 1000 * 1.8 + accuracy * 2);
            if (!(pending >= 0 && elapsed > 0 && elapsed <= 5000 && progress >= pending - 20 && progress <= pending + recoveryAllowance)) {
                pending = progress; pendingAt = at; return Double.NaN;
            }
        }
        uncertain = false; pending = -1;
        last = progress; lastAt = at;
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
