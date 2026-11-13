using Xunit;

// L.Current (UI language) is process-wide: tests that switch it must not run beside the others
[assembly: CollectionBehavior(DisableTestParallelization = true)]
