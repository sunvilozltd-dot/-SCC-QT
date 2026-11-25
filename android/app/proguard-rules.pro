-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-keep class com.sunviloz.cleancare.data.model.** { *; }
-keepclassmembers class * {
    @kotlinx.serialization.SerialName <fields>;
}
