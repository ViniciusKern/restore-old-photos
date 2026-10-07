import { readOrder } from "./restoration";
import { emailLinkMatches, emailLinkOrderId } from "./restoration-email";

export async function readEmailPhoto(token: string) {
  const id = await emailLinkOrderId(token);
  if (!id) return null;
  const order = await readOrder(id);
  return order && emailLinkMatches(order, token) ? order : null;
}
