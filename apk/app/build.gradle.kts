import java.util.Properties

plugins {
    id("com.android.application")
}

val versionProps = Properties().apply {
    val f = rootProject.file("version.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val appVersionName: String = versionProps.getProperty("versionName") ?: "1.0.0"
val appVersionCode: Int = (versionProps.getProperty("versionCode") ?: "1").toInt()

android {
    namespace = "ru.busbus.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.busbus.app"
        minSdk = 23
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        resourceConfigurations += listOf("ru", "en")
    }

    signingConfigs {
        create("release") {
            val storePath = System.getenv("BUSBUS_KEYSTORE") ?: ""
            val storePassword = System.getenv("BUSBUS_KEYSTORE_PASSWORD") ?: ""
            val keyAlias = System.getenv("BUSBUS_KEY_ALIAS") ?: ""
            val keyPassword = System.getenv("BUSBUS_KEY_PASSWORD") ?: ""
            if (storePath.isNotBlank() && file(storePath).exists()) {
                storeFile = file(storePath)
                this.storePassword = storePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val releaseSigning = signingConfigs.getByName("release")
            signingConfig = if (releaseSigning.storeFile != null) releaseSigning else signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += setOf("META-INF/*.kotlin_module")
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.android.material:material:1.12.0")
}
