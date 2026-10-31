import { maskContactValue, type OrderItem } from '../utils/order-utils.ts';

const NOTIFICATION_TIMEOUT_MS = 3000;

/**
 * Optional outbound alert for a newly created order. Configure
 * ORDER_NOTIFICATION_WEBHOOK_URL with a Slack/Feishu/WeCom/HTTP endpoint.
 * The call is bounded and awaited while the request still owns Cloud Run CPU;
 * delivery failure is logged but never fails the order.
 */
export async function notifyNewOrder(order: OrderItem): Promise<void> {
  const url = (process.env.ORDER_NOTIFICATION_WEBHOOK_URL || '').trim();
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'order.created',
        orderNumber: order.orderNumber,
        serviceType: order.serviceType,
        title: order.title,
        budgetRange: order.budgetRange || '',
        status: order.status,
        contactMethod: order.contactMethod,
        maskedContact: maskContactValue(order.contactMethod, order.contactValue),
        createdAt: order.createdAt,
      }),
      signal: AbortSignal.timeout(NOTIFICATION_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[OrderNotification] webhook returned HTTP ${response.status}`);
    }
  } catch (err: any) {
    console.error('[OrderNotification] webhook delivery failed:', err?.message || err);
  }
}
