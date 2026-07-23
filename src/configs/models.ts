import { User } from 'src/modules/users/model/users.model';
import { Project } from 'src/modules/projects/model/project.model';
import { ProjectMember } from 'src/modules/projects/model/project-member.model';
import { UserFavorite } from 'src/modules/projects/model/user-favorite.model';
import { ProjectTag } from 'src/modules/tags/model/project-tag.model';
import { Board } from 'src/modules/boards/model/board.model';
import { BoardColumn } from 'src/modules/columns/model/board-column.model';
import { Task } from 'src/modules/tasks/model/task.model';
import { TaskAssignee } from 'src/modules/tasks/model/task-assignee.model';
import { TaskTag } from 'src/modules/tasks/model/task-tag.model';
import { TaskAttachment } from 'src/modules/tasks/model/task-attachment.model';
import { ActivityEvent } from 'src/modules/activity-events/model/activity-event.model';

const models = [
  User,
  Project,
  ProjectMember,
  UserFavorite,
  ProjectTag,
  Board,
  BoardColumn,
  Task,
  TaskAssignee,
  TaskTag,
  TaskAttachment,
  ActivityEvent
];

export default models;
