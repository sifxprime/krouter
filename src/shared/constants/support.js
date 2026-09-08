/**
 * Where a user can reach a human. One definition, so the dashboard, any future
 * surface, and the docs cannot drift to different numbers or addresses.
 */

export const SUPPORT_EMAIL = "krouter@kodelyth.com";

// wa.me takes the number in international format with no "+" and no separators.
// Keeping the display form beside it means the link and the text a user reads can
// never disagree.
export const SUPPORT_WHATSAPP_NUMBER = "8801312365939";
export const SUPPORT_WHATSAPP_DISPLAY = "+880 1312 365939";
export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`;

export const SUPPORT_CHANNELS = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    detail: SUPPORT_WHATSAPP_DISPLAY,
    href: SUPPORT_WHATSAPP_URL,
    icon: "whatsapp",
    tint: "#25D366",
  },
  {
    id: "email",
    label: "Email",
    detail: SUPPORT_EMAIL,
    href: `mailto:${SUPPORT_EMAIL}`,
    icon: "mail",
  },
];
