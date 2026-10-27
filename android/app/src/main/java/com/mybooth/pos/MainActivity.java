package com.mybooth.pos;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        View content = findViewById(android.R.id.content);
        int insetTypes = WindowInsetsCompat.Type.systemBars()
            | WindowInsetsCompat.Type.displayCutout()
            | WindowInsetsCompat.Type.ime();

        // Apply only the insets left by Capacitor, so native handling never adds them twice.
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets safeArea = windowInsets.getInsets(insetTypes);
            view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom);
            return new WindowInsetsCompat.Builder(windowInsets)
                .setInsets(insetTypes, Insets.NONE)
                .build();
        });
        ViewCompat.requestApplyInsets(content);
    }
}
