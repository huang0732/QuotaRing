using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Automation;
using System.Web.Script.Serialization;

sealed class TaskbarSnapshot {
    public IntPtr Handle;
    public Rectangle Bar;
    public Rectangle[] Occupied=new Rectangle[0];
    public int AppsLeft,TrayLeft;
    public bool Reliable;
    public string Reason="taskbar-layout-pending";
    public long Captured;
}

static class TaskbarPlacement {
    public static object Box(Rectangle r){return new {x=r.X,y=r.Y,width=r.Width,height=r.Height};}
    public static List<Rectangle> Gaps(Rectangle bar,Rectangle screen,IEnumerable<Rectangle> occupied,int margin) {
        Rectangle visible=Rectangle.Intersect(bar,screen);
        var blocks=new List<Rectangle>();
        foreach(Rectangle r in occupied) {
            Rectangle clipped=Rectangle.Intersect(r,visible);
            if(clipped.Width>0&&clipped.Height>0)blocks.Add(clipped);
        }
        blocks.Sort((a,b)=>a.Left.CompareTo(b.Left));
        var gaps=new List<Rectangle>();int cursor=visible.Left+margin,end=visible.Right-margin;
        foreach(Rectangle r in blocks) {
            int left=Math.Max(visible.Left,r.Left-margin),right=Math.Min(visible.Right,r.Right+margin);
            if(left>cursor)gaps.Add(new Rectangle(cursor,visible.Top,left-cursor,visible.Height));
            cursor=Math.Max(cursor,right);
        }
        if(cursor<end)gaps.Add(new Rectangle(cursor,visible.Top,end-cursor,visible.Height));
        // The outer screen margin applies even when the first/last control is offscreen.
        for(int i=0;i<gaps.Count;i++)gaps[i]=Rectangle.Intersect(gaps[i],new Rectangle(visible.Left+margin,visible.Top,Math.Max(0,visible.Width-2*margin),visible.Height));
        return gaps;
    }
    public static Rectangle? Choose(TaskbarSnapshot snapshot,Rectangle screen,Size size,double scale,Rectangle current,out string region) {
        region="taskbar-no-space";
        Rectangle bar=snapshot.Bar,visible=Rectangle.Intersect(bar,screen);
        if(!snapshot.Reliable){region=snapshot.Reason;return null;}
        if(visible.Width<=visible.Height){region="taskbar-orientation-unsupported";return null;}
        if(size.Width<=0||size.Height<=0||size.Height>visible.Height-2)return null;
        int margin=Math.Max(1,(int)Math.Round(12*scale));
        var occupied=new List<Rectangle>(snapshot.Occupied);
        occupied.Add(new Rectangle(snapshot.TrayLeft,bar.Top,Math.Max(0,bar.Right-snapshot.TrayLeft),bar.Height));
        var gaps=Gaps(bar,screen,occupied,margin);
        int y=visible.Top+(visible.Height-size.Height)/2;
        if(current.Width==size.Width&&current.Height==size.Height) {
            foreach(Rectangle gap in gaps)if(current.Left>=gap.Left&&current.Right<=gap.Right) {
                region=current.Right<=snapshot.AppsLeft?"left":"right";
                return new Rectangle(current.Left,y,size.Width,size.Height);
            }
        }
        for(int i=gaps.Count-1;i>=0;i--) {
            Rectangle gap=gaps[i];
            if(gap.Left>=snapshot.AppsLeft&&gap.Width>=size.Width) {
                region="right";return new Rectangle(gap.Right-size.Width,y,size.Width,size.Height);
            }
        }
        foreach(Rectangle gap in gaps) {
            if(gap.Right<=snapshot.AppsLeft&&gap.Width>=size.Width) {
                region="left";return new Rectangle(gap.Left,y,size.Width,size.Height);
            }
        }
        foreach(Rectangle gap in gaps)if(gap.Width>=size.Width) {
            region="other";return new Rectangle(gap.Left,y,size.Width,size.Height);
        }
        return null;
    }
    static Rectangle ReadBox(Dictionary<string,object> v) {
        return new Rectangle(Convert.ToInt32(v["x"]),Convert.ToInt32(v["y"]),Convert.ToInt32(v["width"]),Convert.ToInt32(v["height"]));
    }
    public static TaskbarSnapshot SnapshotForTest(Dictionary<string,object> v) {
        var s=new TaskbarSnapshot{Bar=ReadBox((Dictionary<string,object>)v["bar"]),AppsLeft=Convert.ToInt32(v["appsLeft"]),TrayLeft=Convert.ToInt32(v["trayLeft"]),Reliable=Convert.ToBoolean(v["reliable"]),Reason="taskbar-layout-unknown"};
        var occupied=new List<Rectangle>();foreach(var item in (IEnumerable)v["occupied"])occupied.Add(ReadBox((Dictionary<string,object>)item));s.Occupied=occupied.ToArray();
        return s;
    }
    public static string Evaluate(string input) {
        var json=new JavaScriptSerializer();var v=json.Deserialize<Dictionary<string,object>>(input);var s=SnapshotForTest(v);
        Rectangle screen=ReadBox((Dictionary<string,object>)v["screen"]),current=v.ContainsKey("current")?ReadBox((Dictionary<string,object>)v["current"]):Rectangle.Empty;
        string region;var result=Choose(s,screen,new Size(Convert.ToInt32(v["width"]),Convert.ToInt32(v["height"])),Convert.ToDouble(v["scale"]),current,out region);
        return json.Serialize(new {bounds=result.HasValue?Box(result.Value):null,region=region});
    }
}

// UI Automation calls can block on Explorer. Keep them off the window thread,
// allow only one reader, and discard stale/incomplete snapshots instead of guessing.
sealed class TaskbarScanner {
    readonly object gate=new object();
    readonly AutoResetEvent wake=new AutoResetEvent(false);
    readonly Thread reader;
    bool stopped;
    IntPtr requestedHandle;
    Rectangle requestedBar;
    long nextRequest;
    TaskbarSnapshot latest;
    public TaskbarScanner() {
        reader=new Thread(ReadLoop);reader.IsBackground=true;reader.SetApartmentState(ApartmentState.MTA);reader.Start();
    }
    public void Request(IntPtr handle,Rectangle bar) {
        long now=Stopwatch.GetTimestamp();
        lock(gate) {
            if(stopped)return;
            if(now<nextRequest&&handle==requestedHandle&&bar==requestedBar)return;
            requestedHandle=handle;requestedBar=bar;nextRequest=now+Stopwatch.Frequency/3;
        }
        wake.Set();
    }
    public TaskbarSnapshot Current(IntPtr handle,Rectangle bar) {
        lock(gate) {
            if(latest==null||latest.Handle!=handle||latest.Bar!=bar)return null;
            if((Stopwatch.GetTimestamp()-latest.Captured)/(double)Stopwatch.Frequency>2)return null;
            return latest;
        }
    }
    public void Stop(){lock(gate){stopped=true;}wake.Set();}
    void ReadLoop() {
        while(true) {
            wake.WaitOne();IntPtr handle;Rectangle bar;
            lock(gate){if(stopped){wake.Dispose();return;}handle=requestedHandle;bar=requestedBar;}
            var snapshot=new TaskbarSnapshot{Handle=handle,Bar=bar,Captured=Stopwatch.GetTimestamp(),Reason="taskbar-layout-unknown"};
            try {Read(handle,snapshot);} catch {snapshot.Reliable=false;snapshot.Reason="taskbar-layout-unavailable";}
            lock(gate){latest=snapshot;}
        }
    }
    static void Read(IntPtr handle,TaskbarSnapshot snapshot) {
        var occupied=new List<Rectangle>();bool startFound=false,frameFound=false;
        Rectangle bar=snapshot.Bar;int startLeft=bar.Right,trayLeft=bar.Right;
        Native.Rect trayBounds;IntPtr tray=Native.FindWindowEx(handle,IntPtr.Zero,"TrayNotifyWnd",null);
        bool trayFound=tray!=IntPtr.Zero&&Native.GetWindowRect(tray,out trayBounds);
        if(trayFound){Native.GetWindowRect(tray,out trayBounds);trayLeft=trayBounds.Left;}
        {
            var cache=new CacheRequest();
            cache.TreeScope=TreeScope.Element;
            cache.Add(AutomationElement.BoundingRectangleProperty);cache.Add(AutomationElement.IsOffscreenProperty);
            cache.Add(AutomationElement.ControlTypeProperty);cache.Add(AutomationElement.AutomationIdProperty);cache.Add(AutomationElement.ClassNameProperty);
            using(cache.Activate()) {
                var root=AutomationElement.FromHandle(handle);
                var elements=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
                foreach(AutomationElement element in elements) {
                    var info=element.Cached;if(info.IsOffscreen)continue;
                    var rect=info.BoundingRectangle;
                    if(rect.IsEmpty||rect.Width<=0||rect.Height<=0)continue;
                    Rectangle box=Rectangle.FromLTRB((int)Math.Floor(rect.Left),(int)Math.Floor(rect.Top),(int)Math.Ceiling(rect.Right),(int)Math.Ceiling(rect.Bottom));
                    if(!bar.IntersectsWith(box))continue;
                    string id=info.AutomationId??"",cls=info.ClassName??"";
                    if(id=="TaskbarFrame"||cls=="MSTaskListWClass"||cls=="MSTaskSwWClass")frameFound=true;
                    bool start=id.Equals("StartButton",StringComparison.OrdinalIgnoreCase)||cls=="Start";
                    if(start){startFound=true;startLeft=Math.Min(startLeft,box.Left);}
                    if(cls.StartsWith("SystemTray.",StringComparison.Ordinal)){trayFound=true;trayLeft=Math.Min(trayLeft,box.Left);}
                    // Full-width framework hosts and flexible task-list containers are
                    // not occupied buttons. Small unknown controls remain excluded.
                    bool container=info.ControlType==ControlType.Pane||info.ControlType==ControlType.Window||info.ControlType==ControlType.ToolBar||info.ControlType==ControlType.List;
                    if(container&&(box.Width>=bar.Width*.8||cls=="ReBarWindow32"||cls=="MSTaskSwWClass"||cls=="MSTaskListWClass"))continue;
                    if(box.Width>=bar.Width*.95)continue;
                    occupied.Add(box);
                }
            }
        }
        Native.Rect after;
        if(!Native.GetWindowRect(handle,out after)||after.Box!=bar)return;
        snapshot.AppsLeft=startLeft;snapshot.TrayLeft=trayLeft;snapshot.Occupied=occupied.ToArray();
        snapshot.Reliable=startFound&&frameFound&&trayFound&&trayLeft>startLeft&&trayLeft<=bar.Right&&trayLeft>=bar.Left;
        snapshot.Reason=snapshot.Reliable?"":"taskbar-layout-unknown";
    }
}
