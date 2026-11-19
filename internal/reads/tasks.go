package reads

import (
	"context"
	"net/url"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	"github.com/brickKit/infra-bff-mobile/v3/internal/model"
)

// worklistItem is an entry of infra/workflow's worklist: the task projection (be-protocol schemas/flow/task.v1) with
// the action entry the worklist derived.
type worklistItem struct {
	Task struct {
		ID        string  `json:"id"`
		TaskType  string  `json:"task_type"`
		Component string  `json:"component"`
		State     string  `json:"state"`
		Version   int     `json:"version"`
		DueAt     *string `json:"due_at"`
		Summary   struct {
			Title  string `json:"title"`
			Fields []struct {
				Key   string `json:"key"`
				Label string `json:"label"`
				Value string `json:"value"`
			} `json:"fields"`
		} `json:"summary"`
	} `json:"task"`
	Action     model.TaskAction `json:"action"`
	Stale      bool             `json:"stale"`
	ReceivedAt string           `json:"received_at"`
}

func (w worklistItem) model() model.WorklistTask {
	t := w.Task
	fields := make([]model.SummaryField, 0, len(t.Summary.Fields))
	for _, f := range t.Summary.Fields {
		fields = append(fields, model.SummaryField{Key: f.Key, Label: f.Label, Value: f.Value})
	}
	action := w.Action
	return model.WorklistTask{ID: t.ID, Component: t.Component, TaskType: t.TaskType, State: t.State,
		Version: t.Version, DueAt: t.DueAt, Summary: &model.TaskSummary{Title: t.Summary.Title, Fields: fields},
		Action: &action, Stale: w.Stale, ReceivedAt: w.ReceivedAt}
}

// MyTasks is my pending tasks (infra/workflow GET /api/workflow/tasks).
func (r *Reads) MyTasks(ctx context.Context, taskType, cursor *string, limit *int) (*model.TaskPage, error) {
	var out struct {
		Tasks      []worklistItem `json:"tasks"`
		NextCursor string         `json:"next_cursor"`
	}
	if err := r.b.Get(ctx, core.Workflow, "/api/workflow/tasks", page(cursor, limit, "task_type", str(taskType)), &out); err != nil {
		return nil, err
	}
	p := &model.TaskPage{Items: make([]model.WorklistTask, 0, len(out.Tasks)), NextCursor: out.NextCursor}
	for _, t := range out.Tasks {
		p.Items = append(p.Items, t.model())
	}
	return p, nil
}

// Task is one task by its component and id (infra/workflow GET /api/workflow/tasks/{id}?component=).
func (r *Reads) Task(ctx context.Context, component, id string) (*model.WorklistTask, error) {
	var out worklistItem
	if err := r.b.Get(ctx, core.Workflow, "/api/workflow/tasks/"+url.PathEscape(id),
		url.Values{"component": {component}}, &out); err != nil {
		return nil, err
	}
	t := out.model()
	return &t, nil
}
