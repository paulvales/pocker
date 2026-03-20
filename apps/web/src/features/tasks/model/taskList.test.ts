import { describe, expect, it } from 'vitest';

import {
  getIssueIdFromText,
  getTaskHref,
  getTaskLabel,
  parseTaskListInput,
} from './taskList';

describe('taskList model', () => {
  it('parses unique task references from free-form input', () => {
    expect(
      parseTaskListInput(
        'APP-12\nhttps://tracker.example/APP-15 APP-12, APP-16',
      ),
    ).toEqual([
      'APP-12',
      'https://tracker.example/APP-15',
      'APP-16',
    ]);
  });

  it('extracts canonical issue ids from arbitrary text', () => {
    expect(getIssueIdFromText('issue app_42-7 is ready')).toBe('APP_42-7');
    expect(getIssueIdFromText('no issue id here')).toBe('');
  });

  it('returns safe task hrefs and labels', () => {
    expect(getTaskHref('https://tracker.example/APP-15')).toBe(
      'https://tracker.example/APP-15',
    );
    expect(getTaskHref('ftp://tracker.example/APP-15')).toBeNull();
    expect(getTaskLabel('https://tracker.example/path/APP-15')).toBe('APP-15');
    expect(getTaskLabel('plain-task-reference')).toBe('plain-task-reference');
  });
});
