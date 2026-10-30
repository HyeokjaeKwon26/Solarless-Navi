package com.solaris.nav;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

final class RecoveryHttp {
    static JSONObject fetch(double[] start,double[] end,double bearing,boolean avoidTolls)throws Exception {
        String coordinates=start[0]+","+start[1]+";"+end[0]+","+end[1];
        String query="?overview=full&geometries=geojson&steps=true&alternatives=true&radiuses=40;40";
        if(NavigationProgress.finite(bearing))query+="&bearings="+Math.round((bearing%360+360)%360)+",60;";
        if(avoidTolls)query+="&exclude=toll"; // An unsupported class fails closed; never silently include tolls.
        HttpURLConnection connection=(HttpURLConnection)new URL("https://router.project-osrm.org/route/v1/driving/"+coordinates+query).openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(10000);
        connection.setRequestProperty("User-Agent","SolarLessNavi/Android background recovery");
        long deadline=System.nanoTime()+20000000000L;
        try {
            if(connection.getResponseCode()!=200)throw new IOException("Routing service unavailable");
            if(connection.getContentLength()>2000000)throw new IOException("Response too large");
            try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[8192];int size;
                while((size=in.read(buffer))!=-1){if(out.size()+size>2000000||System.nanoTime()>deadline)throw new IOException("Response limit");out.write(buffer,0,size);}
                return new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
            }
        } finally {connection.disconnect();}
    }
}
