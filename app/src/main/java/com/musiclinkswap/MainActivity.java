package com.musiclinkswap;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.verify.domain.DomainVerificationManager;
import android.content.pm.verify.domain.DomainVerificationUserState;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Map;

/** Setup screen: the two link settings, plus a manual update check. */
public class MainActivity extends Activity {
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        col.setPadding(pad, dp(32), pad, pad);

        TextView title = text("Music Link Swap", 24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        col.addView(title);
        col.addView(text("Version " + BuildConfig.VERSION_NAME, 13));

        col.addView(gap());
        col.addView(text("Tap a Spotify link anywhere and it plays in YouTube Music. "
                + "Share a song from YouTube Music and WhatsApp opens with the Spotify link.", 15));

        col.addView(gap());
        col.addView(heading("Setup (once)"));
        col.addView(text("1. Stop Spotify grabbing Spotify links: turn off \"Open supported links\".", 15));
        col.addView(button("Open Spotify's link settings", () -> openLinkSettings("com.spotify.music")));
        col.addView(text("2. Let this app open them: turn on \"Open supported links\", then add open.spotify.com and spotify.link.", 15));
        col.addView(button("Open this app's link settings", () -> openLinkSettings(getPackageName())));

        status = text("", 15);
        col.addView(status);

        col.addView(gap());
        col.addView(button("Check for app update", this::checkNow));

        ScrollView sv = new ScrollView(this);
        sv.addView(col);
        setContentView(sv);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateStatus();
    }

    private void updateStatus() {
        if (Build.VERSION.SDK_INT < 31) {
            status.setText("");
            return;
        }
        try {
            DomainVerificationManager dvm = getSystemService(DomainVerificationManager.class);
            DomainVerificationUserState st = dvm.getDomainVerificationUserState(getPackageName());
            boolean on = st != null && st.isLinkHandlingAllowed();
            boolean selected = false;
            if (st != null) {
                for (Map.Entry<String, Integer> e : st.getHostToStateMap().entrySet()) {
                    if (e.getKey().equals("open.spotify.com")
                            && e.getValue() != DomainVerificationUserState.DOMAIN_STATE_NONE) {
                        selected = true;
                    }
                }
            }
            status.setText(on && selected
                    ? "✓ This app is opening Spotify links"
                    : "✗ Not opening Spotify links yet. Do step 2 (and step 1 if Spotify is installed).");
        } catch (Exception e) {
            status.setText("");
        }
    }

    private void openLinkSettings(String pkg) {
        Uri uri = Uri.parse("package:" + pkg);
        Intent i = Build.VERSION.SDK_INT >= 31
                ? new Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS, uri)
                : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri);
        try {
            startActivity(i);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri));
        }
    }

    private void checkNow() {
        Toast.makeText(this, "Checking…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String url = UpdateChecker.findUpdate();
            runOnUiThread(() -> {
                if (url == null) {
                    Toast.makeText(this, "You have the latest version", Toast.LENGTH_SHORT).show();
                } else {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                }
            });
        }).start();
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private TextView text(String s, int sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    private TextView heading(String s) {
        TextView t = text(s, 18);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String label, Runnable r) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setGravity(Gravity.CENTER);
        b.setOnClickListener(v -> r.run());
        return b;
    }

    private android.view.View gap() {
        android.view.View v = new android.view.View(this);
        v.setMinimumHeight(dp(16));
        return v;
    }
}
