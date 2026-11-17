package io.fortivex.game;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends AppCompatActivity {

    private WebView mWebView;
    private ConnectivityManager mConnectivityManager;
    private ConnectivityManager.NetworkCallback mNetworkCallback;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Dark theme status bar and navigation bar styling
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#090D16"));
        window.setNavigationBarColor(Color.parseColor("#090D16"));

        WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(window, window.getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(false);
            insetsController.setAppearanceLightNavigationBars(false);
        }

        // Layout container
        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.parseColor("#090D16"));

        mWebView = new WebView(this);
        mWebView.setBackgroundColor(Color.parseColor("#090D16"));
        rootLayout.addView(mWebView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootLayout);

        // WebView Settings Configuration
        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Hardware Acceleration
        mWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // Add JavaScript Interface for Native Hardware Capabilities
        mWebView.addJavascriptInterface(new FortivexNativeInterface(this), "FortivexNative");

        mWebView.setWebChromeClient(new WebChromeClient());
        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false; // Load all game pages inside Fortivex container
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject native indicator to Web JS
                mWebView.evaluateJavascript("window.IS_NATIVE_ANDROID = true; console.log('[FortivexNative] Android bridge active');", null);
            }
        });

        // Register Network Monitor to dispatch events to JS on network recovery
        registerNetworkMonitoring();

        // Load Game assets or server URL
        String serverUrl = getIntent().getStringExtra("server_url");
        if (serverUrl != null && !serverUrl.isEmpty()) {
            mWebView.loadUrl(serverUrl);
        } else {
            // Default: local bundled assets or local dev server
            mWebView.loadUrl("file:///android_asset/index.html");
        }
    }

    private void registerNetworkMonitoring() {
        mConnectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (mConnectivityManager != null) {
            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();

            mNetworkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(@NonNull Network network) {
                    runOnUiThread(() -> {
                        if (mWebView != null) {
                            mWebView.evaluateJavascript("window.dispatchEvent(new Event('online'));", null);
                        }
                    });
                }

                @Override
                public void onLost(@NonNull Network network) {
                    runOnUiThread(() -> {
                        if (mWebView != null) {
                            mWebView.evaluateJavascript("window.dispatchEvent(new Event('offline'));", null);
                        }
                    });
                }
            };

            mConnectivityManager.registerNetworkCallback(request, mNetworkCallback);
        }
    }

    @Override
    public void onBackPressed() {
        // Query Fortivex UI whether an overlay/sheet/active match can handle back
        if (mWebView != null) {
            mWebView.evaluateJavascript("window.handleAndroidBackButton ? window.handleAndroidBackButton() : false;", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if ("true".equalsIgnoreCase(value)) {
                        // Consumed by Fortivex UI (closed modal, left room confirmation, etc.)
                        return;
                    }

                    // Otherwise prompt exit confirmation
                    showExitDialog();
                }
            });
        } else {
            super.onBackPressed();
        }
    }

    private void showExitDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.exit_confirm_title)
                .setMessage(R.string.exit_confirm_message)
                .setPositiveButton(R.string.yes, (dialog, which) -> finish())
                .setNegativeButton(R.string.no, null)
                .show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (mConnectivityManager != null && mNetworkCallback != null) {
            try {
                mConnectivityManager.unregisterNetworkCallback(mNetworkCallback);
            } catch (Exception ignored) {}
        }
        if (mWebView != null) {
            mWebView.destroy();
        }
    }

    // Native Bridge Interface
    public class FortivexNativeInterface {
        private final Context context;

        public FortivexNativeInterface(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public void vibrate(int durationMs) {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(durationMs);
                }
            }
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public String getPlatform() {
            return "android";
        }

        @JavascriptInterface
        public void exitApp() {
            finish();
        }
    }
}
