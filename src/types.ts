export interface Env {
  CLASS_DB: D1Database;
  APP_NAME: string;
}

export type IdentityMode = 'login_required' | 'guest_only' | 'hybrid';
export type RegistrationSuccessMode = 'free' | 'register_then_pay' | 'pay_then_confirm';
export type RegistrationStatus = 'draft' | 'pending_payment' | 'confirmed' | 'waitlist' | 'cancelled' | 'expired' | 'checked_in' | 'no_show';
export type PaymentStatus = 'not_required' | 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded';

export interface RegistrationItemInput {
  itemId: string;
  quantity: number;
}

export interface IdentityInput {
  type: 'member' | 'guest';
  provider?: string;
  externalMemberId?: string;
  displayName?: string;
  phone?: string;
  email?: string;
}

export interface CreateRegistrationInput {
  sessionId?: string;
  items: RegistrationItemInput[];
  identity?: IdentityInput;
  externalSource?: string;
  externalMemberId?: string;
  contact: {
    name: string;
    phone?: string;
    email?: string;
  };
  customData?: Record<string, unknown>;
  attendees?: Array<{
    itemId?: string;
    attendeeIndex: number;
    name?: string;
    phone?: string;
    email?: string;
    customData?: Record<string, unknown>;
  }>;
}
