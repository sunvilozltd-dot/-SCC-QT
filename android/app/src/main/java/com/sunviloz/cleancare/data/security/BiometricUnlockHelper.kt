package com.sunviloz.cleancare.data.security

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Native Android BiometricPrompt wrapper supporting fingerprint / strong biometrics
 * and phone screen lock (PIN, pattern, or password) via DEVICE_CREDENTIAL.
 *
 * The app never accesses or stores phone PINs or biometric templates — Android OS
 * handles verification natively inside the Trusted Execution Environment.
 */
object BiometricUnlockHelper {

    private const val ALLOWED_AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL

    fun canUseDeviceUnlock(activity: FragmentActivity): Boolean {
        val manager = BiometricManager.from(activity)
        return manager.canAuthenticate(ALLOWED_AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS
    }

    fun promptUnlock(
        activity: FragmentActivity,
        accountLabel: String,
        onSuccess: () -> Unit,
        onFallbackToPassword: () -> Unit,
        onError: (String) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                super.onAuthenticationSucceeded(result)
                onSuccess()
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                super.onAuthenticationError(errorCode, errString)
                when (errorCode) {
                    BiometricPrompt.ERROR_USER_CANCELED,
                    BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                    BiometricPrompt.ERROR_CANCELED -> onFallbackToPassword()
                    else -> onError(errString.toString())
                }
            }
        }

        val prompt = BiometricPrompt(activity, executor, callback)
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock SUNVILOZ Clean Care")
            .setSubtitle("Verify with fingerprint or phone screen lock for $accountLabel")
            .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)
            .build()

        prompt.authenticate(info)
    }
}
