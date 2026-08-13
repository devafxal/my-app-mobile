package com.azsolve.user

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    createChatNotificationChannel()
  }

  /**
   * Android 8+ silently drops any notification whose channel does not exist,
   * so the channel the backend targets ("task_reminders") has to be created
   * here, before the first push ever arrives.
   */
  private fun createChatNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val channel =
      NotificationChannel(
        CHANNEL_ID,
        "Task Reminders",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Reminders to complete your tasks"
        enableVibration(true)
      }

    val manager = getSystemService(NotificationManager::class.java)
    manager?.createNotificationChannel(channel)
  }

  companion object {
    const val CHANNEL_ID = "task_reminders"
  }
}
