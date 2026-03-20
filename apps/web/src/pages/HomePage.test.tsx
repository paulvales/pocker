import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { HomePage } from './HomePage';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('HomePage', () => {
  it('renders the legacy create-room shell and routes into the room slug', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('pokerName', 'Alice');

    render(
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/:roomSlug" element={<div>Room route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Скрум Покер Онлине')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Название комнаты'), 'alpha-room');
    await user.click(screen.getByRole('button', { name: 'Создать комнату' }));

    expect(window.sessionStorage.getItem('pockerCreateRoomIntent')).toBe('alpha-room');

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/alpha-room');
    });
  });
});
