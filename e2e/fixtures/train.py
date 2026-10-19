import numpy as np

def accuracy(pred, label):
    """Fraction of correct predictions."""
    return float(np.mean(pred == label))

if __name__ == "__main__":
    print(accuracy(np.array([1, 0, 1]), np.array([1, 1, 1])))
