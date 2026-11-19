param([Parameter(Mandatory=$true)][string]$PipeName)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class JtcPipeServer {
    static readonly object outputLock = new object();
    static readonly ConcurrentDictionary<int, StreamWriter> clients = new ConcurrentDictionary<int, StreamWriter>();
    static readonly ConcurrentDictionary<int, NamedPipeServerStream> streams = new ConcurrentDictionary<int, NamedPipeServerStream>();
    static int nextId;
    static int active;
    static bool stopping;
    static void Output(string text) { lock(outputLock) { Console.Out.WriteLine(text); Console.Out.Flush(); } }
    static string ReadLimited(TextReader reader) {
        var data = new System.Text.StringBuilder();
        for (int i=0; i<524288; i++) {
            int c=reader.Read();
            if (c<0) return null;
            if (c==10) return data.ToString();
            data.Append((char)c);
        }
        throw new IOException("MESSAGE_TOO_LARGE");
    }
    static NamedPipeServerStream Create(string name) {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid,null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        return new NamedPipeServerStream(name, PipeDirection.InOut, 8, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536,65536,security);
    }
    static void Handle(NamedPipeServerStream pipe) {
        int id = Interlocked.Increment(ref nextId);
        streams[id]=pipe;
        using (var timer=new Timer(_=> { try { pipe.Dispose(); } catch {} },null,55000,Timeout.Infinite)) {
            try {
                var reader=new StreamReader(pipe,new System.Text.UTF8Encoding(false),false,4096,true);
                var writer=new StreamWriter(pipe,new System.Text.UTF8Encoding(false),4096,true); writer.AutoFlush=true;
                clients[id]=writer;
                string request=ReadLimited(reader);
                if(request==null) return;
                new JavaScriptSerializer().DeserializeObject(request);
                Output("{\"clientId\":"+id+",\"request\":"+request+"}");
                while(pipe.IsConnected && clients.ContainsKey(id) && !stopping) Thread.Sleep(20);
            } catch {} finally {
                StreamWriter ignored; clients.TryRemove(id,out ignored);
                NamedPipeServerStream unused; streams.TryRemove(id,out unused);
                pipe.Dispose();
                Interlocked.Decrement(ref active);
            }
        }
    }
    public static void Run(string name) {
        if(!System.Text.RegularExpressions.Regex.IsMatch(name,"^jtcrpa-mcp-[a-f0-9]{32}$")) throw new Exception("Invalid pipe name");
        var first=Create(name);
        Output("{\"ready\":true,\"acl\":\"current-user;deny-network\"}");
        Task.Run(()=> {
            var pipe=first;
            while(!stopping) {
                try {
                    pipe.WaitForConnection();
                    var accepted=pipe;
                    Interlocked.Increment(ref active);
                    Task.Run(()=>Handle(accepted));
                    while(!stopping && Interlocked.CompareExchange(ref active,0,0)>=7) Thread.Sleep(20);
                    if(stopping) break;
                    pipe=Create(name);
                } catch(Exception e) { if(!stopping) Console.Error.WriteLine(e.Message); break; }
            }
        });
        string line;
        while((line=Console.ReadLine())!=null) {
            try {
                var json=new JavaScriptSerializer();
                var msg=(Dictionary<string,object>)json.DeserializeObject(line);
                int id=Convert.ToInt32(msg["clientId"]);
                StreamWriter writer;
                if(clients.TryGetValue(id,out writer)) {
                    writer.WriteLine(json.Serialize(msg["body"]));
                    clients.TryRemove(id,out writer);
                }
            } catch(Exception e) { Console.Error.WriteLine(e.Message); }
        }
        stopping=true;
        first.Dispose();
        foreach(var stream in streams.Values) stream.Dispose();
    }
}
'@
[JtcPipeServer]::Run($PipeName)
