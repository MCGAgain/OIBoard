package com.oiboard.app.data.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 基于 Android KeyStore 的 AES-256-GCM 硬件/系统级安全加密管理器
 * - 密钥存储于 AndroidKeyStore 中不可导出
 * - 每次加密使用安全随机生成的 12 字节 IV
 * - 密文由 IV (12B) + Ciphertext + Tag (16B) 组成，以 Base64 安全持久化
 * - 解密失败（密钥失效、系统还原或损坏）返回 null，绝不崩溃
 */
object CryptoManager {

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "oiboard_master_crypto_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LENGTH_BYTES = 12
    private const val TAG_LENGTH_BITS = 128

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply {
            load(null)
        }
    }

    @Synchronized
    private fun getOrCreateSecretKey(): SecretKey {
        if (keyStore.containsAlias(KEY_ALIAS)) {
            val entry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
            if (entry != null) {
                return entry.secretKey
            }
        }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        )

        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(false)
            .setRandomizedEncryptionRequired(true)
            .build()

        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    /**
     * 加密明文字符串，返回 Base64 密文字符串；若异常则返回 null
     */
    fun encrypt(plainText: String): String? {
        if (plainText.isEmpty()) return ""
        return try {
            val secretKey = getOrCreateSecretKey()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey)

            val iv = cipher.iv
            val cipherBytes = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))

            val combined = ByteArray(iv.size + cipherBytes.size)
            System.arraycopy(iv, 0, combined, 0, iv.size)
            System.arraycopy(cipherBytes, 0, combined, iv.size, cipherBytes.size)

            Base64.encodeToString(combined, Base64.NO_WRAP)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * 解密 Base64 密文字符串，返回原始明文；若解密失败（如设备重置或秘钥变更）返回 null
     */
    fun decrypt(encryptedBase64: String): String? {
        if (encryptedBase64.isEmpty()) return ""
        return try {
            val combined = Base64.decode(encryptedBase64, Base64.NO_WRAP)
            if (combined.size <= IV_LENGTH_BYTES) return null

            val iv = ByteArray(IV_LENGTH_BYTES)
            val cipherBytes = ByteArray(combined.size - IV_LENGTH_BYTES)
            System.arraycopy(combined, 0, iv, 0, IV_LENGTH_BYTES)
            System.arraycopy(combined, IV_LENGTH_BYTES, cipherBytes, 0, cipherBytes.size)

            val secretKey = getOrCreateSecretKey()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            val gcmSpec = GCMParameterSpec(TAG_LENGTH_BITS, iv)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmSpec)

            val decryptedBytes = cipher.doFinal(cipherBytes)
            String(decryptedBytes, Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }
}
