import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let routerQuery: Record<string, string> = {};

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: routerQuery,
    replace: vi.fn(),
    pathname: '/settings/plan',
    asPath: '/settings/plan',
    events: { on: () => {}, off: () => {} },
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, default: vi.fn() };
});

import useSWR from 'swr';
import PlanSettingsPage from '../../pages/settings/plan';

describe('PlanSettingsPage', () => {
  const billing = {
    planKey: 'basic',
    planName: 'Basic',
    mode: 'platform',
    modeLabel: 'Open42 keys',
    hasByokKeys: false,
    subscriptionStatus: 'active',
    subscriptionActive: true,
    hasStripeCustomer: true,
    hasStripeSubscription: true,
    currentPeriodStart: '2026-05-01T00:00:00.000Z',
    currentPeriodEnd: '2026-06-01T00:00:00.000Z',
    includedRequests: 100,
    usedRequests: 42,
    includedRequestsRemaining: 58,
    meteredRequests: 0,
    upgradesEnabled: true,
    checkoutConfigured: true,
    overageMeterConfigured: true,
    portalAvailable: true,
  };

  beforeEach(() => {
    routerQuery = {};
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        billing,
      },
      error: null,
      mutate: vi.fn(),
    });
  });

  it('renders workspace billing status', () => {
    render(<PlanSettingsPage />);
    expect(screen.getByText(/Workspace billing/i)).toBeInTheDocument();
    expect(screen.getByText(/Basic/i)).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it('renders included request usage', () => {
    render(<PlanSettingsPage />);
    expect(screen.getByText(/Shared-key request allowance/i)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('58 included left')).toBeInTheDocument();
  });

  it('renders Open42 keys and BYOK actions', () => {
    render(<PlanSettingsPage />);
    expect(screen.getAllByText(/Open42 keys/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BYOK/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Manage/i }).length).toBe(2);
  });

  it('disables BYOK checkout until a workspace provider key exists', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        billing: {
          ...billing,
          subscriptionStatus: null,
          subscriptionActive: false,
          hasStripeCustomer: false,
          hasStripeSubscription: false,
          portalAvailable: false,
        },
      },
      error: null,
      mutate: vi.fn(),
    });

    render(<PlanSettingsPage />);
    const subscribeButtons = screen.getAllByRole('button', { name: /Subscribe/i });
    expect(subscribeButtons).toHaveLength(2);
    expect(subscribeButtons[0]).not.toBeDisabled();
    expect(subscribeButtons[1]).toBeDisabled();
    expect(
      screen.getByText(/Add a workspace provider key before subscribing to BYOK/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Selected')).not.toBeInTheDocument();
  });

  it('disables paid upgrade actions while upgrades are paused', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        billing: {
          ...billing,
          subscriptionStatus: null,
          subscriptionActive: false,
          hasStripeCustomer: false,
          hasStripeSubscription: false,
          upgradesEnabled: false,
          checkoutConfigured: false,
          portalAvailable: false,
        },
      },
      error: null,
      mutate: vi.fn(),
    });

    render(<PlanSettingsPage />);
    const subscribeButtons = screen.getAllByRole('button', { name: /Subscribe/i });
    expect(subscribeButtons).toHaveLength(2);
    expect(subscribeButtons[0]).toBeDisabled();
    expect(subscribeButtons[1]).toBeDisabled();
    expect(screen.getByText(/Paid upgrades are paused/i)).toBeInTheDocument();
  });

  it('shows a checkout return banner', () => {
    routerQuery = { checkout: 'success' };
    render(<PlanSettingsPage />);
    expect(screen.getByText(/Stripe checkout completed/i)).toBeInTheDocument();
  });
});
