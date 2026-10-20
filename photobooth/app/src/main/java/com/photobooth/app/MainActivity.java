package com.photobooth.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.print.PrintHelper;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * หน้าจอเดียวของแอป: เป็น WebView ที่โหลดหน้าเว็บใน assets/www ผ่าน https://appassets.androidplatform.net
 * (ได้ secure context สำหรับเปิดกล้อง) และมีสะพาน AndroidBridge ให้หน้าเว็บเรียก: พิมพ์, เซฟรูป, ส่งข้อมูลขึ้น Apps Script
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final String UPLOAD_HOST = "script.google.com";
    private static final int REQ_CAMERA = 1001;
    private static final int REQ_FILE = 1002;

    private WebView webView;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> filePathCallback;
    private final ExecutorService io = Executors.newFixedThreadPool(2);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#F5F3FC"));
        setContentView(webView);
        hideSystemBars();

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // ไม่ให้หน้าเว็บพาออกไปเว็บอื่น
                return !HOST.equals(request.getUrl().getHost());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d("PhotoBooth-JS", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");

        // ขอสิทธิ์กล้องตั้งแต่เปิดแอป เจ้าหน้าที่จะได้กดอนุญาตครั้งเดียวก่อนเริ่มงาน
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }

        webView.loadUrl(START_URL);
    }

    private void handleWebPermission(PermissionRequest request) {
        boolean wantsVideo = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsVideo = true;
        }
        if (!wantsVideo || !HOST.equals(request.getOrigin().getHost())) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingPermission = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA && pendingPermission != null) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingPermission.deny();
            pendingPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ปุ่ม Back: ให้หน้าเว็บจัดการเอง (หน้าแรกจะไม่ทำอะไร กันแขกเผลอออกจากแอป)
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        webView.evaluateJavascript("window.__pbBack&&window.__pbBack()", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    /** ส่งผลของ httpRequest กลับไปให้หน้าเว็บ */
    private void deliver(String id, boolean ok, String text) {
        final String js = "window.__pbNative&&window.__pbNative(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(text) + ")";
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    private String doHttp(String method, String urlStr, String body) throws Exception {
        URL url = new URL(urlStr);
        if (!"https".equals(url.getProtocol()) || !UPLOAD_HOST.equals(url.getHost())) {
            throw new Exception("อนุญาตเฉพาะ https://" + UPLOAD_HOST);
        }
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        try {
            c.setConnectTimeout(20000);
            c.setReadTimeout(90000);
            c.setInstanceFollowRedirects(true);   // Apps Script ตอบ 302 แล้วให้ตามไปรับผลด้วย GET
            c.setRequestMethod(method);
            if ("POST".equals(method)) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = is == null ? "" : readAll(is);
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            return text;
        } finally {
            c.disconnect();
        }
    }

    private static String readAll(InputStream is) throws Exception {
        try (InputStream in = is; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /** เมธอดที่หน้าเว็บเรียกได้ผ่าน window.AndroidBridge */
    private class Bridge {

        @JavascriptInterface
        public boolean isNative() {
            return true;
        }

        /** สั่งพิมพ์รูป (เปิดหน้าต่างพิมพ์ของ Android ให้เลือกเครื่องพิมพ์/ยืนยัน) */
        @JavascriptInterface
        public void printImage(String base64, final String jobName) {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            final Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) {
                toast("อ่านรูปสำหรับพิมพ์ไม่ได้");
                return;
            }
            runOnUiThread(() -> {
                PrintHelper helper = new PrintHelper(MainActivity.this);
                helper.setScaleMode(PrintHelper.SCALE_MODE_FIT);
                helper.setColorMode(PrintHelper.COLOR_MODE_COLOR);
                helper.setOrientation(bmp.getWidth() > bmp.getHeight()
                        ? PrintHelper.ORIENTATION_LANDSCAPE : PrintHelper.ORIENTATION_PORTRAIT);
                helper.printBitmap(jobName == null || jobName.isEmpty() ? "PhotoBooth" : jobName, bmp);
            });
        }

        /** เก็บสำเนารูปไว้ที่ Pictures/PhotoBooth (Android 10 ขึ้นไป) */
        @JavascriptInterface
        public boolean saveImage(String base64, String name) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PhotoBooth");
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return false;
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) return false;
                    os.write(bytes);
                }
                return true;
            } catch (Exception e) {
                Log.w("PhotoBooth", "saveImage failed", e);
                return false;
            }
        }

        /** ส่ง HTTP ไป Apps Script จากโค้ดเนทีฟ (ไม่ติด CORS) ผลลัพธ์กลับทาง window.__pbNative(id, ok, text) */
        @JavascriptInterface
        public void httpRequest(final String id, final String method, final String url, final String body) {
            io.execute(() -> {
                boolean ok;
                String text;
                try {
                    text = doHttp(method, url, body);
                    ok = true;
                } catch (Exception e) {
                    ok = false;
                    text = e.getMessage() == null ? e.toString() : e.getMessage();
                }
                deliver(id, ok, text);
            });
        }
    }
}
