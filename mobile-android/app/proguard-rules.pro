# R8 / Proguard rules for OIBoard Native App

# Kotlinx serialization
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote kotlinx.serialization.SerializationKt
-keepclassmembers class * {
    *** Companion;
}
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep all data models and serialization generated classes
-keep class com.oiboard.app.data.model.** { *; }
-keepclassmembers class com.oiboard.app.data.model.** { *; }
-keep interface com.oiboard.app.data.model.** { *; }

# OkHttp & Okio
-dontwarn okhttp3.**
-dontwarn okio.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# Coil
-keepclassmembers class * extends coil.intercept.Interceptor { *; }

# Android JsonReader (standard SDK, keep no warnings)
-dontwarn android.util.JsonReader
-dontwarn android.util.JsonToken
