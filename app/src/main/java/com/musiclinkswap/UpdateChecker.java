package com.musiclinkswap;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

/** Looks for a newer app build on GitHub Releases and offers it as a one-tap notification. */
final class UpdateChecker {
    private UpdateChecker() {}

    private static final long INTERVAL_MS = 12L * 60 * 60 * 1000;
    private static final String CHANNEL = "updates";

    /** Returns the .apk download URL if a newer build exists, else null. */
    static String findUpdate() {
        JSONObject r = Net.get("https://api.github.com/repos/" + BuildConfig.REPO + "/releases/latest", null, 6000);
        if (r.optInt("status") != 200) return null;
        try {
            JSONObject rel = new JSONObject(r.getString("body"));
            int latest = Integer.parseInt(rel.optString("tag_name", "v0").replaceAll("[^0-9]", ""));
            if (latest <= BuildConfig.VERSION_CODE) return null;
            JSONArray assets = rel.optJSONArray("assets");
            if (assets == null) return null;
            for (int i = 0; i < assets.length(); i++) {
                String u = assets.getJSONObject(i).optString("browser_download_url");
                if (u.endsWith(".apk")) return u;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    static void checkInBackground(Context c, boolean force) {
        SharedPreferences p = c.getSharedPreferences("mls", Context.MODE_PRIVATE);
        long last = p.getLong("lastCheck", 0);
        if (!force && System.currentTimeMillis() - last < INTERVAL_MS) return;
        p.edit().putLong("lastCheck", System.currentTimeMillis()).apply();
        String url = findUpdate();
        if (url != null) notifyUpdate(c, url);
    }

    static void notifyUpdate(Context c, String url) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent pi = PendingIntent.getActivity(c, 0,
                new Intent(Intent.ACTION_VIEW, Uri.parse(url)),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Music Link Swap update available")
                .setContentText("Tap to download, then open it to install")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        try {
            nm.notify(1, n);
        } catch (SecurityException ignored) {
        }
    }
}
