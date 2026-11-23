import { ActivityEvent } from '../src/modules/activity-events/model/activity-event.model';
import {
  ActivityActionType,
  ActivityEntityType
} from '../src/modules/activity-events/activity-events.constants';
import { TaskAssignee } from '../src/modules/tasks/model/task-assignee.model';
import { TaskTag } from '../src/modules/tasks/model/task-tag.model';
import { TaskAttachment } from '../src/modules/tasks/model/task-attachment.model';
import type { Task } from '../src/modules/tasks/model/task.model';
import { Task as TaskModel } from '../src/modules/tasks/model/task.model';
import { Project } from '../src/modules/projects/model/project.model';
import { ProjectMember } from '../src/modules/projects/model/project-member.model';
import { UserFavorite } from '../src/modules/projects/model/user-favorite.model';
import type { TaskTimeEntryPage } from '../src/modules/tasks/interfaces/task-time-entry.interface';

declare const task: Task;

const executorId: number = task.assignees[0].userId;
const tagId: number = task.tags[0].projectTagId;
const uploadedById: number = task.attachments[0].uploadedById;

// @ts-expect-error Model relations must not erase the ID type to any.
const invalidExecutorId: string = task.assignees[0].userId;
// @ts-expect-error Unknown relation fields must be rejected.
task.assignees[0].inventedField;
// @ts-expect-error Tags retain their actual association shape.
task.tags[0].tagId;
// @ts-expect-error Attachment fields remain checked.
const invalidSize: string = task.attachments[0].size;

ActivityEvent.create({
  projectId: 1,
  entityType: ActivityEntityType.Task,
  entityId: '1',
  actionType: ActivityActionType.Created
});
// @ts-expect-error An event requires its entity ID even when defaults are omitted.
ActivityEvent.create({
  projectId: 1,
  entityType: ActivityEntityType.Task,
  actionType: ActivityActionType.Created
});
ActivityEvent.create({
  projectId: 1,
  entityType: ActivityEntityType.Task,
  // @ts-expect-error SQL entity IDs are strings, not numbers.
  entityId: 1,
  actionType: ActivityActionType.Created
});
TaskAssignee.bulkCreate([{ taskId: 1, userId: 2 }]);
// @ts-expect-error Assignee IDs cannot be strings.
TaskAssignee.bulkCreate([{ taskId: 1, userId: '2' }]);
// @ts-expect-error Assignment creation requires a user.
TaskAssignee.create({ taskId: 1 });
TaskTag.bulkCreate([{ taskId: 1, projectTagId: 2 }]);
// @ts-expect-error A task tag requires its project tag ID.
TaskTag.create({ taskId: 1 });
// @ts-expect-error Attachment creation requires metadata, not only a task ID.
TaskAttachment.create({ taskId: 1 });
// @ts-expect-error Time-entry pages include the total even if the page is empty.
const invalidTimePage: TaskTimeEntryPage = { items: [], nextCursor: null };

void [
  executorId,
  tagId,
  uploadedById,
  invalidExecutorId,
  invalidSize,
  invalidTimePage
];

TaskModel.create({ taskNumber: 1, title: 'Task', columnId: 1, createdById: 2 });
// @ts-expect-error A task creation payload requires the creator ID.
TaskModel.create({ taskNumber: 1, title: 'Task', columnId: 1 });
TaskModel.create({
  taskNumber: 1,
  title: 'Task',
  // @ts-expect-error Task column IDs cannot be strings.
  columnId: '1',
  createdById: 2
});
Project.create({ title: 'Project', prefix: 'PRJ', createdById: 1 });
// @ts-expect-error Project creation requires its prefix.
Project.create({ title: 'Project', createdById: 1 });
ProjectMember.bulkCreate([{ projectId: 1, userId: 2 }]);
// @ts-expect-error Project membership requires a user ID.
ProjectMember.create({ projectId: 1 });
// @ts-expect-error Favorite project IDs remain numeric.
UserFavorite.create({ projectId: '1', userId: 2 });
// @ts-expect-error Typed relations retain the ID shape throughout the project graph.
const invalidProjectId: string =
  task.column.board.project.members[0].project.id;
// @ts-expect-error Typed nested associations do not accept arbitrary properties.
task.column.board.project.tags[0].taskTags[0].inventedField;

void invalidProjectId;
