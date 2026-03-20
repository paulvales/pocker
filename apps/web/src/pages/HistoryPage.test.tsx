import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryPage } from './HistoryPage';

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

describe('HistoryPage', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders history items and normalizes the page query from backend pagination', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          items: [
            {
              roomId: 'alpha-room',
            taskId: 'APP-21',
            participantName: 'Viewer',
            estimate: '8',
            estimateType: 'hours',
            recordedAt: '2026-03-20T12:00:00.000Z',
          },
        ],
        meta: {
          rooms: ['alpha-room'],
          participants: ['Viewer'],
          estimateTypes: ['hours'],
          pagination: {
            page: 1,
            pageSize: 25,
            totalItems: 1,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        },
      }),
    } as Response);

    render(
      <MemoryRouter initialEntries={['/history?participantName=Viewer&page=9']}>
        <LocationProbe />
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('APP-21');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/estimation-history?participantName=Viewer&page=9',
      expect.any(Object),
    );

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/history?participantName=Viewer',
      );
    });
  });

  it('applies form filters through the query string and requests the new slice', async () => {
    const user = userEvent.setup();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          items: [],
          meta: {
            rooms: ['alpha-room'],
          participants: [],
          estimateTypes: ['points', 'hours'],
          pagination: {
            page: 1,
            pageSize: 25,
            totalItems: 0,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        },
      }),
    } as Response);

    render(
      <MemoryRouter initialEntries={['/history']}>
        <LocationProbe />
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText('Room'), 'alpha-room');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/estimation-history?roomId=alpha-room',
        expect.any(Object),
      );
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/history?roomId=alpha-room',
      );
    });
  });
});
