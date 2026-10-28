package com.solaris.nav;

import java.util.Locale;

/** Presentation only; route progress, thresholds and speed comparisons stay in SI. */
final class GuidanceUnits {
    static String spokenDistance(double meters, String system, String language) {
        double value = Double.isNaN(meters) || Double.isInfinite(meters) ? 0 : Math.max(0, meters);
        boolean imperial = "imperial".equals(system), ko = language != null && language.startsWith("ko");
        String amount, unit;
        if (value >= (imperial ? 160.9344 : 1000)) {
            amount = String.format(Locale.US, "%.1f", value / (imperial ? 1609.344 : 1000));
            unit = imperial ? (ko ? "마일" : "miles") : (ko ? "킬로미터" : "kilometers");
        } else {
            long rounded = Math.round(value / (imperial ? 0.3048 : 1) / 10) * 10;
            amount = String.valueOf(value > 0 ? Math.max(10, rounded) : 0);
            unit = imperial ? (ko ? "피트" : "feet") : (ko ? "미터" : "meters");
        }
        return amount + (ko ? "" : " ") + unit;
    }
}
