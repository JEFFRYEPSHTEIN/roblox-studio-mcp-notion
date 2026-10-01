-- Evaluation fixture v1. MANUAL SETUP ONLY; not executed by the MCP launcher.
-- Paste once into Roblox Studio's Command Bar in a NEW disposable Place in Edit mode.
-- Creates four McpEvaluationV1 folders. Does not remove or replace existing objects.
-- All Script/LocalScript instances are disabled; ModuleScripts are data/source fixtures.

local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterGui = game:GetService("StarterGui")
local marker = "McpEvaluationV1"
assert(not RunService:IsRunning(), "Stop the playtest. Install the fixture in Edit mode only.")
for _, service in ipairs({ workspace, ReplicatedStorage, ServerScriptService, StarterGui }) do
    assert(not service:FindFirstChild(marker), "Fixture already exists. Use another NEW disposable Place; nothing was changed.")
end

local function create(className, name, parent, properties, attributes, tags)
    local item = Instance.new(className)
    item.Name = name
    if item:IsA("BaseScript") then item.Disabled = true end
    for key, value in pairs(properties or {}) do item[key] = value end
    for key, value in pairs(attributes or {}) do item:SetAttribute(key, value) end
    CollectionService:AddTag(item, "McpEvalV1")
    for _, tag in ipairs(tags or {}) do CollectionService:AddTag(item, tag) end
    item.Parent = parent
    return item
end

local world = create("Folder", marker, workspace, nil, { FixtureVersion = 1, Scenario = "Harbor response rehearsal" })
local data = create("Folder", marker, ReplicatedStorage, nil, { FixtureVersion = 1 })
local server = create("Folder", marker, ServerScriptService, nil, { FixtureVersion = 1 })
local ui = create("Folder", marker, StarterGui, nil, { FixtureVersion = 1 })
local districts = create("Folder", "Districts", world)
local harbor = create("Model", "Harbor", districts, nil, { DistrictCode = "HBR" })
local foundry = create("Model", "Foundry", districts, nil, { DistrictCode = "FND" })
local outpost = create("Model", "Outpost", districts, nil, { DistrictCode = "OUT" })

local function part(name, parent, position, attributes, canCollide, tag)
    return create("Part", name, parent, { Anchored = true, Size = Vector3.new(4, 2, 4), Position = position, CanCollide = canCollide }, attributes, { tag })
end

local harborGates = create("Folder", "Passages", harbor)
local foundryGates = create("Folder", "Passages", foundry)
local outpostGates = create("Folder", "Passages", outpost)
part("SluiceGate", harborGates, Vector3.new(0, 2, 0), { RuleKey = "resident_lane", Purpose = "Drain", CredentialKey = "PublicSlip", HoldSeconds = 4, Active = true }, true, "McpEvalGate")
part("IronGate", foundryGates, Vector3.new(30, 2, 0), { RuleKey = "watch_lane", Purpose = "Secure", CredentialKey = "GuardBadge", HoldSeconds = 7, Active = true }, true, "McpEvalGate")
part("FerryGate", outpostGates, Vector3.new(60, 2, 0), { RuleKey = "freight_lane", Purpose = "Freight", CredentialKey = "DockPass", HoldSeconds = 9, Active = true }, true, "McpEvalGate")

local pads = create("Folder", "Recovery", harbor)
part("RelayPad", pads, Vector3.new(0, 5, 15), { PadKey = "primary", Available = false, EmergencyAllowed = true }, false, "McpEvalRecovery")
part("LifeboatPad", pads, Vector3.new(12, 12, 15), { PadKey = "backup", Available = true, EmergencyAllowed = true }, false, "McpEvalRecovery")
part("ServicePad", pads, Vector3.new(24, 2, 15), { PadKey = "staff", Available = true, EmergencyAllowed = false }, false, "McpEvalRecovery")

part("HarborDynamo", harbor, Vector3.new(0, 3, 30), { SupplyKey = "harbor", Active = true, Watts = 760, FuelUnitsPerMinute = 4 }, true, "McpEvalSupply")
part("FoundryTurbine", foundry, Vector3.new(30, 3, 30), { SupplyKey = "foundry", Active = false, Watts = 900, FuelUnitsPerMinute = 9 }, true, "McpEvalSupply")
part("OutpostBattery", outpost, Vector3.new(60, 3, 30), { SupplyKey = "outpost", Active = true, Watts = 630, FuelUnitsPerMinute = 3 }, true, "McpEvalSupply")

local corridor = create("Folder", "DeliveryCorridor", world)
for index, row in ipairs({
    { "DockMarker", "dock", false }, { "BridgePanel", "bridge", true },
    { "YardFence", "yard", true }, { "RampMarker", "ramp", false }, { "RefugeMarker", "refuge", false },
}) do
    part(row[1], corridor, Vector3.new(index * 6, 1, 45), { NodeKey = row[2] }, row[3], "McpEvalRouteNode")
end
part("DecorativeCrate", corridor, Vector3.new(36, 1, 45), { NodeKey = "decoration" }, true, "McpEvalDecoration")

local shelter = create("Model", "SafeHouse", outpost)
part("Floor", shelter, Vector3.new(60, 0, 50), { ComponentKey = "floor" }, true, "McpEvalShelterBody")
part("Wall", shelter, Vector3.new(60, 3, 52), { ComponentKey = "wall" }, true, "McpEvalShelterBody")
part("Roof", shelter, Vector3.new(60, 6, 50), { ComponentKey = "roof" }, false, "McpEvalShelterBody")

local configurations = create("Folder", "Configurations", data)
local function module(name, source)
    return create("ModuleScript", name, configurations, { Source = source }, { FixtureVersion = 1 }, { "McpEvalConfiguration" })
end
module("EntryPolicies", [=[
return {
    resident_lane = { Role = "Resident", MinimumReputation = 3 },
    watch_lane = { Role = "Security", MinimumReputation = 20 },
    freight_lane = { Role = "Transport", MinimumReputation = 0 },
}
]=])
module("PassRegister", [=[
return {
    PublicSlip = { Enabled = true, ExpiresOn = "2024-08-20" },
    GuardBadge = { Enabled = true, ExpiresOn = "2024-07-01" },
    DockPass = { Enabled = false, ExpiresOn = "2024-12-31" },
}
]=])
module("RecoveryPlan", [=[
return {
    PowerFailureOrder = { "primary", "backup", "staff" },
    IdentifierAttribute = "PadKey",
    EligibilityAttributes = { "Available", "EmergencyAllowed" },
    -- Select the first entry whose two eligibility attributes are both true.
}
]=])
module("SupplyPlan", [=[
return {
    PermittedKeys = { "harbor", "foundry", "outpost" },
    IdentifierAttribute = "SupplyKey",
    -- Only Active supplies qualify; maximize Watts / FuelUnitsPerMinute.
}
]=])
module("DeliveryPlan", [=[
return {
    NodeKeys = { "dock", "bridge", "yard", "ramp", "refuge" },
    IdentifierAttribute = "NodeKey",
    -- Decoration is not part of the planned route.
}
]=])
module("ShelterPlan", [=[
return {
    ComponentKeys = { "floor", "wall", "roof" },
    IdentifierAttribute = "ComponentKey",
    RequiredProperty = "CanCollide",
    -- A shelter passes the solid-body audit only when all listed components are true.
}
]=])
module("StartupPlan", [=[
return {
    InitialDisplayState = "DockReady",
    GateSequence = { "resident_lane", "watch_lane", "freight_lane" },
    DelayAttribute = "HoldSeconds",
    ProgressIndicatorKey = "BeaconA",
}
]=])
module("DisplayBindings", [=[
return {
    DefaultLanguage = "en",
    LabelByState = { DockReady = "HarborStatus", Inspect = "InspectionStatus" },
    IndicatorIdentifierAttribute = "ViewKey",
}
]=])
module("LocaleCatalog", [=[
return {
    en = { DockReady = "Ready to dock", Inspect = "Inspection required" },
    fr = { DockReady = "Accostage autorise", Inspect = "Inspection requise" },
}
]=])
module("DispatchRoutes", [=[
return {
    AdministrativeGateAction = "GateRequest",
    StatusAction = "StatusRequest",
    -- EventKey attributes resolve these names to RemoteEvent instances.
}
]=])

local channels = create("Folder", "Channels", data)
create("RemoteEvent", "GateControl", channels, nil, { EventKey = "GateRequest" }, { "McpEvalChannel" })
create("RemoteEvent", "HarborTelemetry", channels, nil, { EventKey = "StatusRequest" }, { "McpEvalChannel" })
create("Script", "GateAuthority", server, { Source = [=[
-- Disabled source fixture: study the code; do not enable or run it.
local channels = game.ReplicatedStorage.McpEvaluationV1.Channels
local gateEvent = channels.GateControl
gateEvent.OnServerEvent:Connect(function(player, gateKey)
    if player:GetAttribute("TeamRole") ~= "Warden" then return end
    -- Authorized handler only. Fixture intentionally performs no game mutation.
end)
]=] }, { HandlesEventKey = "GateRequest" }, { "McpEvalHandler" })
create("Script", "StatusAuthority", server, { Source = [=[
-- Disabled source fixture. The status channel does not control gates.
local event = game.ReplicatedStorage.McpEvaluationV1.Channels.HarborTelemetry
event.OnServerEvent:Connect(function(player)
    if player:GetAttribute("TeamRole") ~= "Observer" then return end
end)
]=] }, { HandlesEventKey = "StatusRequest" }, { "McpEvalHandler" })

local console = create("ScreenGui", "HarborConsole", ui, { Enabled = false, ResetOnSpawn = false })
local panel = create("Frame", "RootPanel", console, { Size = UDim2.fromOffset(320, 120) })
create("TextLabel", "HarborStatus", panel, { Text = "Ready to dock", Size = UDim2.fromOffset(200, 30) }, { BindingState = "DockReady" })
create("TextLabel", "InspectionStatus", panel, { Text = "Inspection required", Size = UDim2.fromOffset(200, 30), Position = UDim2.fromOffset(0, 35) }, { BindingState = "Inspect" })
local overlay = create("Folder", "Overlays", panel)
create("Frame", "SignalDot", overlay, { BackgroundColor3 = Color3.fromRGB(255, 120, 10), Size = UDim2.fromOffset(12, 12) }, { ViewKey = "BeaconA" }, { "McpEvalIndicator" })
create("TextLabel", "SignalText", overlay, { Text = "standby", Size = UDim2.fromOffset(80, 20) }, { ViewKey = "BeaconB" }, { "McpEvalIndicator" })

print("McpEvaluationV1 fixture created manually. Keep this disposable Place in Edit mode. Evaluation has NOT been run.")
