"use client";

import PresidioSettingsCard from "./PresidioSettingsCard";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* The title lives in the header bar. This page used to paint its own,
          and called itself "Settings" while the bar called it "Presidio". */}
      <PresidioSettingsCard />
    </div>
  );
}
