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

  it('initializes fomantic dropdown widgets when jQuery is available', async () => {
    const dropdownCalls = new Map<string, ReturnType<typeof vi.fn>>();
    const jqueryMock = vi.fn((element: Element) => {
      const dropdown = vi.fn();
      dropdownCalls.set((element as HTMLElement).id, dropdown);
      return { dropdown };
    });

    vi.stubGlobal('$', jqueryMock);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          items: [],
          meta: {
            rooms: ['alpha-room'],
            participants: ['Viewer'],
            estimateTypes: ['points'],
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
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(jqueryMock).toHaveBeenCalled();
      expect(dropdownCalls.get('roomDropdown')).toBeDefined();
      expect(dropdownCalls.get('participantDropdown')).toBeDefined();
      expect(dropdownCalls.get('estimateTypeDropdown')).toBeDefined();
      expect(dropdownCalls.get('pageSizeDropdown')).toBeDefined();
    });

    expect(dropdownCalls.get('roomDropdown')).toHaveBeenCalledWith('refresh');
    expect(dropdownCalls.get('participantDropdown')).toHaveBeenCalledWith('refresh');
    expect(dropdownCalls.get('estimateTypeDropdown')).toHaveBeenCalledWith('refresh');
    expect(dropdownCalls.get('pageSizeDropdown')).toHaveBeenCalledWith('refresh');
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

    expect(screen.getByText('История оценок')).toBeInTheDocument();

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

    await user.selectOptions(screen.getByLabelText('Комната'), 'alpha-room');
    await user.click(screen.getByRole('button', { name: 'Применить' }));

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
