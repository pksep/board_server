import type { Optional } from 'sequelize';
import type { TaskAssignee } from '../model/task-assignee.model';
import type { TaskTag } from '../model/task-tag.model';
import type { TaskAttachment } from '../model/task-attachment.model';
import type { Task } from '../model/task.model';

export type TaskCreationAttributes = Optional<
  Pick<
    Task,
    | 'id'
    | 'taskNumber'
    | 'title'
    | 'description'
    | 'priority'
    | 'approvalStatus'
    | 'dueDate'
    | 'startDate'
    | 'customAttributeValues'
    | 'linkedEntity'
    | 'columnId'
    | 'parentTaskId'
    | 'order'
    | 'createdById'
    | 'responsibleIds'
    | 'timeNormMinutes'
    | 'controllerIds'
  >,
  | 'id'
  | 'description'
  | 'priority'
  | 'approvalStatus'
  | 'dueDate'
  | 'startDate'
  | 'customAttributeValues'
  | 'linkedEntity'
  | 'parentTaskId'
  | 'order'
  | 'responsibleIds'
  | 'timeNormMinutes'
  | 'controllerIds'
>;

export type TaskAssigneeCreationAttributes = Optional<
  Pick<TaskAssignee, 'id' | 'taskId' | 'userId' | 'productionStartDate'>,
  'id' | 'productionStartDate'
>;

export type TaskTagCreationAttributes = Optional<
  Pick<TaskTag, 'id' | 'taskId' | 'projectTagId'>,
  'id'
>;

export type TaskAttachmentCreationAttributes = Optional<
  Pick<
    TaskAttachment,
    | 'id'
    | 'taskId'
    | 'fileName'
    | 'objectName'
    | 'mimeType'
    | 'size'
    | 'uploadedById'
  >,
  'id'
>;
