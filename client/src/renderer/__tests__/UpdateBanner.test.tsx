/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UpdateBanner } from '../components/UpdateBanner';
import type { UpdateStatus } from '../../shared-types/ipc';

type StatusCb = (s: UpdateStatus) => void;

let statusCb: StatusCb | null = null;
let fallbackCb: StatusCb | null = null;
const installNowMock = jest.fn();
const openDownloadMock = jest.fn();

beforeEach(() => {
  statusCb = null;
  fallbackCb = null;
  installNowMock.mockReset().mockResolvedValue({ ok: true });
  openDownloadMock.mockReset().mockResolvedValue({ ok: true });

  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      update: {
        checkNow: jest.fn(),
        openDownload: openDownloadMock,
        installNow: installNowMock,
        onStatusChanged: (cb: StatusCb) => {
          statusCb = cb;
          return () => {
            statusCb = null;
          };
        },
        onManualFallback: (cb: StatusCb) => {
          fallbackCb = cb;
          return () => {
            fallbackCb = null;
          };
        },
      },
    },
  });
});

describe('UpdateBanner', () => {
  test('renders nothing initially', () => {
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  test('shows the available banner on update-available event', () => {
    render(<UpdateBanner />);
    act(() => {
      statusCb?.({ kind: 'available', version: '2.0.1' });
    });
    expect(screen.getByText(/Aeris 2\.0\.1 available/i)).toBeInTheDocument();
  });

  test('shows downloaded banner with a working Restart now button', () => {
    render(<UpdateBanner />);
    act(() => {
      statusCb?.({ kind: 'downloaded', version: '2.0.1' });
    });
    expect(screen.getByText(/Aeris 2\.0\.1 ready/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restart now/i }));
    expect(installNowMock).toHaveBeenCalled();
  });

  test('shows manual-fallback banner with a working Download button', () => {
    render(<UpdateBanner />);
    act(() => {
      fallbackCb?.({
        kind: 'manual-fallback',
        version: '2.0.1',
        htmlUrl: 'https://github.com/ClermontDigital/aeris_client/releases/tag/client-v2.0.1',
      });
    });
    expect(screen.getByText(/Aeris 2\.0\.1 is available/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download/i }));
    expect(openDownloadMock).toHaveBeenCalledWith(
      'https://github.com/ClermontDigital/aeris_client/releases/tag/client-v2.0.1',
    );
  });

  test('dismiss button hides the banner', () => {
    render(<UpdateBanner />);
    act(() => {
      statusCb?.({ kind: 'downloaded', version: '2.0.1' });
    });
    expect(screen.getByText(/Aeris 2\.0\.1 ready/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(screen.queryByText(/Aeris 2\.0\.1 ready/i)).toBeNull();
  });
});
