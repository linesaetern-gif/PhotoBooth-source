plugins {
    id("com.android.application")
}

android {
    namespace = "com.photobooth.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.photobooth.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")   // WebViewAssetLoader: เสิร์ฟหน้าเว็บในแอปผ่าน https
    implementation("androidx.print:print:1.0.0")      // PrintHelper: สั่งพิมพ์รูป
}
