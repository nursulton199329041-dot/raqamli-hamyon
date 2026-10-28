namespace Hamyon.Api.Data;

/// <summary>
/// The financial profile the current request works in. Resolved once per request (header <c>X-Profile-Id</c>, else the
/// account's default profile) and applied to every query through a global filter, so no endpoint can read or write
/// another profile's rows by sending its ids.
/// </summary>
public sealed class ProfileScope
{
    public Guid? ProfileId { get; private set; }

    public void Use(Guid profileId) => ProfileId = profileId;
}
