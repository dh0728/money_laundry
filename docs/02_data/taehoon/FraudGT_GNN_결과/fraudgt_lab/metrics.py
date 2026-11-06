"""Report official scored-subset metrics and requested-target coverage separately."""
import numpy as np


def binary_average_precision(positive, scores):
    """Unweighted binary AP, grouping equal scores as sklearn does.

    Avoid sklearn's label discovery via np.unique: the installed NumPy 2.4.1
    unique path retains input copies on repeated calls (see hourly_health).
    The caller already knows that the labels are binary.
    """
    positive = np.asarray(positive, dtype=bool)
    scores = np.asarray(scores)
    if positive.ndim != 1 or scores.ndim != 1 or positive.shape != scores.shape:
        raise ValueError('Binary AP requires equally sized one-dimensional arrays')
    if not np.isfinite(scores).all():
        raise ValueError('Binary AP requires finite scores')
    if not positive.any():
        return 0.0
    order = np.argsort(scores, kind='mergesort')[::-1]
    ordered_scores = scores[order]
    last_in_group = np.r_[np.flatnonzero(np.diff(ordered_scores)), len(scores) - 1]
    true_positives = np.cumsum(positive[order], dtype=np.float64)[last_in_group]
    precision = true_positives / (last_in_group + 1)
    recall = true_positives / true_positives[-1]
    # Match sklearn's decreasing-recall integration and its final (P=1,R=0).
    precision = np.r_[precision[::-1], 1.0]
    recall = np.r_[recall[::-1], 0.0]
    return float(max(0.0, -np.sum(np.diff(recall) * precision[:-1])))

class EpochMetrics:
    def __init__(self):
        self.requested=0;self.requested_positive=0;self.requested_unmatched=0
        self.loss_sum=0.;self.labels=[];self.logits=[]
    def add_requested(self,labels):
        self.requested+=len(labels);self.requested_positive+=int((labels>0).sum());self.requested_unmatched+=int((labels==9).sum())
    def add_scored(self,labels,logits,loss_sum):
        self.labels.append(np.asarray(labels,np.int8));self.logits.append(np.asarray(logits,np.float32));self.loss_sum+=float(loss_sum)
    def state(self):
        return {'requested':self.requested,'requested_positive':self.requested_positive,'requested_unmatched':self.requested_unmatched,
                'loss_sum':self.loss_sum,'labels':self.labels,'logits':self.logits}
    @classmethod
    def restore(cls,state):
        obj=cls()
        if state is not None:obj.__dict__.update(state)
        return obj
    def compute(self):
        y=np.concatenate(self.labels) if self.labels else np.empty(0,np.int8)
        scores=np.concatenate(self.logits) if self.logits else np.empty(0,np.float32)
        positive=y>0;pred=scores>0
        tp=int((positive&pred).sum());fp=int((~positive&pred).sum());fn=int((positive&~pred).sum())
        ratio=lambda a,b:float(a/b) if b else 0.
        unmatched=y==9;known=positive&~unmatched
        return {'loss':ratio(self.loss_sum,len(y)),'accuracy_at_05':float((positive==pred).mean()) if len(y) else 0.,
                'precision_at_05':ratio(tp,tp+fp),'recall_at_05':ratio(tp,tp+fn),'F1':ratio(2*tp,2*tp+fp+fn),
                'AP':binary_average_precision(positive,scores),
                'unmatched_recall_at_05':ratio(int((unmatched&pred).sum()),int(unmatched.sum())),
                'known_recall_at_05':ratio(int((known&pred).sum()),int(known.sum())),
                'requested':self.requested,'scored':len(y),'coverage':ratio(len(y),self.requested),
                'requested_positive':self.requested_positive,'scored_positive':int(positive.sum()),
                'requested_recall_lower_bound':ratio(tp,self.requested_positive),
                'requested_unmatched_recall_lower_bound':ratio(int((unmatched&pred).sum()),self.requested_unmatched),
                'missing_positive':self.requested_positive-int(positive.sum()),'missing_targets':self.requested-len(y)}
