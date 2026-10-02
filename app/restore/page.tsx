import type { Metadata } from "next";
import { RestorePhotoFlow } from "../_components/restore/restore-photo-flow";

export const metadata: Metadata = {
  title: "Restore a Photo | Restore Old Photos",
  description:
    "Choose or capture an old photo, adjust the crop, and prepare it for restoration.",
};

export default function RestorePage() {
  return <RestorePhotoFlow />;
}
