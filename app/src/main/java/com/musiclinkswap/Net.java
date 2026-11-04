package com.musiclinkswap;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

import org.json.JSONObject;

/** Small HTTP helper used by both the script engine and the update check. */
final class Net {
    private Net() {}

    static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

    /** Returns {"status": int, "body": string, "url": finalUrl}; status 0 means no connection. */
    static JSONObject get(String url, JSONObject headers, int timeoutMs) {
        JSONObject out = new JSONObject();
        HttpURLConnection conn = null;
        try {
            String current = url;
            // Follow up to 5 redirects by hand so http->https hops work too.
            for (int hop = 0; hop < 5; hop++) {
                conn = (HttpURLConnection) new URL(current).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(timeoutMs);
                conn.setReadTimeout(timeoutMs);
                conn.setRequestProperty("User-Agent", UA);
                conn.setRequestProperty("Accept-Language", "en-GB,en;q=0.9");
                if (headers != null) {
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        conn.setRequestProperty(k, headers.optString(k));
                    }
                }
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                    current = new URL(new URL(current), conn.getHeaderField("Location")).toString();
                    conn.disconnect();
                    continue;
                }
                InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String body = in == null ? "" : read(in, 4 * 1024 * 1024);
                out.put("status", code);
                out.put("body", body);
                out.put("url", current);
                return out;
            }
            out.put("status", 0);
            out.put("body", "");
            out.put("url", current);
        } catch (Exception e) {
            try {
                out.put("status", 0);
                out.put("body", "");
                out.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
        return out;
    }

    static String read(InputStream in, int max) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) != -1 && buf.size() < max) buf.write(b, 0, n);
        in.close();
        return buf.toString("UTF-8");
    }
}
