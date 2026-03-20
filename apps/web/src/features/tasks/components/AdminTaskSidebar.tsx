import { useMemo, useState } from 'react';

import {
  getTaskHref,
  getTaskLabel,
  parseTaskListInput,
} from '../model/taskList';

type AdminTaskSidebarProps = {
  connectionReady: boolean;
  note: string;
  onSaveNote: (note: string) => Promise<void>;
  onSaveTaskList: (items: string[]) => Promise<void>;
  onSelectTask: (direction: -1 | 1) => Promise<void>;
  pending: {
    noteUpdate: boolean;
    taskListUpdate: boolean;
    taskSelect: boolean;
  };
  roomId: string;
  selectedIndex: number;
  selectedTask: string | null;
  taskItems: string[];
};

type TaskListEditorProps = {
  connectionReady: boolean;
  initialText: string;
  onSave: (items: string[]) => Promise<void>;
  pending: boolean;
};

type NoteEditorProps = {
  connectionReady: boolean;
  initialValue: string;
  onSave: (note: string) => Promise<void>;
  pending: boolean;
};

function TaskListEditor({
  connectionReady,
  initialText,
  onSave,
  pending,
}: TaskListEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const parsedItems = useMemo(() => parseTaskListInput(draft), [draft]);

  async function handleSave() {
    await onSave(parsedItems);
  }

  return (
    <article className="panel session-rail-card">
      <p className="eyebrow">Task list</p>
      <h2>Manage backlog links</h2>
      <textarea
        className="room-textarea"
        rows={10}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        placeholder="https://tracker.example/ABC-123"
      />
      <p className="field-help">
        Parsed tasks: {parsedItems.length}. Separate items with spaces, commas or
        new lines.
      </p>
      <div className="hero-actions">
        <button
          className="button-primary"
          type="button"
          disabled={!connectionReady || pending}
          onClick={() => {
            void handleSave();
          }}
        >
          {pending ? 'Saving list...' : 'Save task list'}
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={pending}
          onClick={() => {
            setDraft('');
          }}
        >
          Clear draft
        </button>
      </div>
    </article>
  );
}

function NoteEditor({
  connectionReady,
  initialValue,
  onSave,
  pending,
}: NoteEditorProps) {
  const [draft, setDraft] = useState(initialValue);

  async function handleSave() {
    await onSave(draft);
  }

  return (
    <article className="panel session-rail-card">
      <p className="eyebrow">Note</p>
      <h2>Admin note</h2>
      <textarea
        className="room-textarea"
        rows={6}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        placeholder="Paste the current issue id or extra context for the room."
      />
      <div className="hero-actions">
        <button
          className="button-primary"
          type="button"
          disabled={!connectionReady || pending}
          onClick={() => {
            void handleSave();
          }}
        >
          {pending ? 'Saving note...' : 'Save note'}
        </button>
      </div>
    </article>
  );
}

export function AdminTaskSidebar({
  connectionReady,
  note,
  onSaveNote,
  onSaveTaskList,
  onSelectTask,
  pending,
  roomId,
  selectedIndex,
  selectedTask,
  taskItems,
}: AdminTaskSidebarProps) {
  const selectedTaskHref = selectedTask ? getTaskHref(selectedTask) : null;
  const hasTasks = taskItems.length > 0;
  const canMoveBackward = hasTasks && selectedIndex > 0 && !pending.taskSelect;
  const canMoveForward =
    hasTasks && selectedIndex < taskItems.length - 1 && !pending.taskSelect;

  return (
    <>
      <article className="panel panel-subtle session-rail-card">
        <p className="eyebrow">Task wheel</p>
        <h2>Current task</h2>
        {selectedTask ? (
          selectedTaskHref ? (
            <a
              className="task-link-card"
              href={selectedTaskHref}
              rel="noreferrer"
              target="_blank"
            >
              <span className="status-label">Selected task</span>
              <strong>{getTaskLabel(selectedTask)}</strong>
              <span className="field-help">{selectedTask}</span>
            </a>
          ) : (
            <div className="task-link-card">
              <span className="status-label">Selected task</span>
              <strong>{getTaskLabel(selectedTask)}</strong>
              <span className="field-help">{selectedTask}</span>
            </div>
          )
        ) : (
          <p className="entry-status">
            No task is selected yet. Load a task list to enable task navigation.
          </p>
        )}

        <div className="hero-actions">
          <button
            className="button-secondary"
            type="button"
            disabled={!connectionReady || !canMoveBackward}
            onClick={() => {
              void onSelectTask(-1);
            }}
          >
            Previous
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={!connectionReady || !canMoveForward}
            onClick={() => {
              void onSelectTask(1);
            }}
          >
            Next
          </button>
        </div>

        <p className="field-help">
          {taskItems.length
            ? `${selectedIndex + 1} of ${taskItems.length} tasks in the current room.`
            : 'The room is still operating without a shared task backlog.'}
        </p>
      </article>

      <TaskListEditor
        key={`${roomId}:${taskItems.join('\n')}`}
        connectionReady={connectionReady}
        initialText={taskItems.join('\n')}
        onSave={onSaveTaskList}
        pending={pending.taskListUpdate}
      />

      <NoteEditor
        key={`${roomId}:${note}`}
        connectionReady={connectionReady}
        initialValue={note}
        onSave={onSaveNote}
        pending={pending.noteUpdate}
      />
    </>
  );
}
