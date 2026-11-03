plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
// Версия приходит из тега сборки (a1.2.3): -PappVersion=1.2.3 -PappCode=10203
val ksFile: String? = System.getenv("ANDROID_KEYSTORE_FILE")
android {
    namespace = "app.electronchat"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.electronchat"
        minSdk = 26
        targetSdk = 34
        versionCode = (findProperty("appCode") as String?)?.toInt() ?: 1
        versionName = (findProperty("appVersion") as String?) ?: "1.0.0"
    }
    signingConfigs {
        if (ksFile != null) create("release") {
            storeFile = file(ksFile)
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ksFile != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
